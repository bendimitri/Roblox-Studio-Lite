--[[
	Studio Lite Luau runtime: the Roblox script environment on top of luau-web.

	Everything a script touches lives here in Luau (scheduler, datatypes, signals, Instance proxies,
	TweenService...). JavaScript is only reached through the synchronous __h_* host functions, which
	speak in flat "tagged" value lists (see decode/encode), and drives time by calling the returned
	step function once per frame. Host calls never yield, so scripts can't stall the page.
]]

local H = {
	get = __h_get, set = __h_set, call = __h_call, children = __h_children, descendants = __h_descendants,
	find = __h_find, ancestor = __h_ancestor, parent = __h_parent, new = __h_new, clone = __h_clone,
	destroy = __h_destroy, service = __h_service, isa = __h_isa, fullname = __h_fullname, listen = __h_listen,
	print = __h_print, enum = __h_enum, enumitems = __h_enumitems, chunk = __h_chunk, game = __h_game,
}
pcall(function()
	for k in H do
		_G["__h_" .. k] = nil
	end
end)

local unpack = table.unpack

-- luau-web pushes every value of a JS array result (and every call argument) onto the Lua
-- stack without growing it: long lists overflow the stack and corrupt the WASM heap. The host
-- packs lists longer than a few values into one string ("\1" + items joined by "\30"; each item
-- is n / t / f / d<number> / s<string>, with \30 and \31 escaped as \31\29 and \31\31).
local function unescapeItem(c)
	return c == "\29" and "\30" or c
end
local function unpackList(packed)
	local items = string.split(string.sub(packed, 2), "\30")
	local out = table.create(#items)
	for i, it in items do
		local k = string.sub(it, 1, 1)
		if k == "d" then
			out[i] = tonumber(string.sub(it, 2))
		elseif k == "s" then
			local s = string.sub(it, 2)
			if string.find(s, "\31", 1, true) then
				s = string.gsub(s, "\31(.)", unescapeItem)
			end
			out[i] = s
		elseif k == "t" then
			out[i] = true
		elseif k == "f" then
			out[i] = false
		end
	end
	return out, #items
end
local function isPacked(first, n)
	return n == 1 and type(first) == "string" and string.byte(first, 1) == 1
end
-- Host result -> (table, count) without ever spreading it on the stack.
local function hostList(...)
	local n = select("#", ...)
	local first = ...
	if isPacked(first, n) then
		return unpackList(first)
	end
	return { ... }, n
end
local function hostValues(...)
	local n = select("#", ...)
	local first = ...
	if isPacked(first, n) then
		local t, count = unpackList(first)
		return unpack(t, 1, count)
	end
	return ...
end
local rawChildren, rawDescendants = H.children, H.descendants
for k, f in H do
	H[k] = function(...)
		return hostValues(f(...))
	end
end
function H.childrenList(id)
	return hostList(rawChildren(id))
end
function H.descendantsList(id)
	return hostList(rawDescendants(id))
end
local sqrt, sin, cos, abs, atan2, asin, floor, clamp, max, min =
	math.sqrt, math.sin, math.cos, math.abs, math.atan2, math.asin, math.floor, math.clamp, math.max, math.min

local function fmt(n)
	if n == floor(n) and abs(n) < 1e15 then
		return string.format("%d", n)
	end
	return string.format("%.6g", n)
end

------------------------------------------------------------------------------------------------
-- Scheduler: every script body and event handler is a coroutine resumed from step().
------------------------------------------------------------------------------------------------

local now = 0
local frame = 0
local sleeping = {}
local deferred = {}
local cancelled = setmetatable({}, { __mode = "k" })

local function formatError(err, trace)
	local msg = tostring(err)
	local lines = { msg, "Stack Begin" }
	for line in string.gmatch(trace or "", "[^\n]+") do
		local src, ln, rest = string.match(line, "^(.-):(%d+):?%s*(.*)$")
		if src and src ~= "runtime" and src ~= "[C]" then
			local fn = string.match(rest or "", "function%s+(.+)$")
			table.insert(lines, string.format("Script '%s', Line %s%s", src, ln, fn and (" - function " .. fn) or ""))
		end
	end
	table.insert(lines, "Stack End")
	return table.concat(lines, "\n")
end

local function onError(err)
	H.print("error", formatError(err, debug.traceback("", 2)))
	return err
end

local function body(fn, ...)
	xpcall(fn, onError, ...)
end

local function resumeThread(co, ...)
	if cancelled[co] or coroutine.status(co) ~= "suspended" then
		return
	end
	local ok, err = coroutine.resume(co, ...)
	if not ok then
		H.print("error", formatError(err, debug.traceback(co)))
	end
end

local function spawnThread(fn, ...)
	local co = coroutine.create(body)
	resumeThread(co, fn, ...)
	return co
end

local function sleep(seconds, co, ...)
	table.insert(sleeping, { co = co, wake = now + max(seconds or 0, 0), start = now, frame = frame, args = select("#", ...) > 0 and table.pack(...) or nil })
end

local function currentThread()
	if not coroutine.isyieldable() then
		error("task.wait/yield só pode ser usado dentro de um script em execução", 3)
	end
	return coroutine.running()
end

local task = {}

function task.wait(seconds)
	local co = currentThread()
	sleep(seconds, co)
	return coroutine.yield()
end

function task.spawn(f, ...)
	if type(f) == "thread" then
		resumeThread(f, ...)
		return f
	end
	return spawnThread(f, ...)
end

function task.defer(f, ...)
	local co = type(f) == "thread" and f or coroutine.create(body)
	if type(f) == "thread" then
		table.insert(deferred, { co = co, args = table.pack(...) })
	else
		table.insert(deferred, { co = co, args = table.pack(f, ...) })
	end
	return co
end

function task.delay(seconds, f, ...)
	local co = type(f) == "thread" and f or coroutine.create(body)
	if type(f) == "thread" then
		sleep(seconds, co, ...)
	else
		sleep(seconds, co, f, ...)
	end
	return co
end

function task.cancel(co)
	cancelled[co] = true
	if coroutine.status(co) == "suspended" then
		pcall(coroutine.close, co)
	end
end

function task.synchronize() end
function task.desynchronize() end

------------------------------------------------------------------------------------------------
-- typeof + datatypes (pure Luau, immutable like the engine's)
------------------------------------------------------------------------------------------------

local TYPE = setmetatable({}, { __mode = "k" })
local nativeTypeof = typeof

local function rbxtypeof(v)
	local mt = getmetatable(v)
	if mt and TYPE[mt] then
		return TYPE[mt]
	end
	return nativeTypeof(v)
end

local function readonly(name)
	return function(_, k)
		error(string.format("%s cannot be assigned to", tostring(k)), 2)
	end
end

-- Vector3 ------------------------------------------------------------------------------------
local Vector3 = {}
local V3 = {}
TYPE[V3] = "Vector3"
local function v3(x, y, z)
	return setmetatable({ X = x, Y = y, Z = z }, V3)
end
local V3methods = {}
V3.__index = function(v, k)
	if k == "Magnitude" then
		return sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z)
	elseif k == "Unit" then
		local m = sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z)
		if m == 0 then
			return v3(0, 0, 0)
		end
		return v3(v.X / m, v.Y / m, v.Z / m)
	elseif k == "x" then
		return v.X
	elseif k == "y" then
		return v.Y
	elseif k == "z" then
		return v.Z
	end
	local m = V3methods[k]
	if m then
		return m
	end
	error(tostring(k) .. " is not a valid member of Vector3", 2)
end
V3.__newindex = readonly("Vector3")
V3.__add = function(a, b)
	return v3(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
end
V3.__sub = function(a, b)
	return v3(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
end
V3.__mul = function(a, b)
	if type(a) == "number" then
		return v3(a * b.X, a * b.Y, a * b.Z)
	elseif type(b) == "number" then
		return v3(a.X * b, a.Y * b, a.Z * b)
	end
	return v3(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
V3.__div = function(a, b)
	if type(b) == "number" then
		return v3(a.X / b, a.Y / b, a.Z / b)
	elseif type(a) == "number" then
		return v3(a / b.X, a / b.Y, a / b.Z)
	end
	return v3(a.X / b.X, a.Y / b.Y, a.Z / b.Z)
end
V3.__idiv = function(a, b)
	return v3(a.X // b, a.Y // b, a.Z // b)
end
V3.__unm = function(a)
	return v3(-a.X, -a.Y, -a.Z)
end
V3.__eq = function(a, b)
	return a.X == b.X and a.Y == b.Y and a.Z == b.Z
end
V3.__tostring = function(v)
	return fmt(v.X) .. ", " .. fmt(v.Y) .. ", " .. fmt(v.Z)
end
function V3methods.Dot(a, b)
	return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end
function V3methods.Cross(a, b)
	return v3(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X)
end
function V3methods.Lerp(a, b, t)
	return v3(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t)
end
function V3methods.FuzzyEq(a, b, eps)
	eps = eps or 1e-5
	return abs(a.X - b.X) <= eps and abs(a.Y - b.Y) <= eps and abs(a.Z - b.Z) <= eps
end
function V3methods.Abs(a)
	return v3(abs(a.X), abs(a.Y), abs(a.Z))
end
function V3methods.Floor(a)
	return v3(floor(a.X), floor(a.Y), floor(a.Z))
end
function V3methods.Ceil(a)
	return v3(math.ceil(a.X), math.ceil(a.Y), math.ceil(a.Z))
end
function V3methods.Sign(a)
	return v3(math.sign(a.X), math.sign(a.Y), math.sign(a.Z))
end
function V3methods.Min(a, b)
	return v3(min(a.X, b.X), min(a.Y, b.Y), min(a.Z, b.Z))
end
function V3methods.Max(a, b)
	return v3(max(a.X, b.X), max(a.Y, b.Y), max(a.Z, b.Z))
end
function V3methods.Angle(a, b)
	local d = V3methods.Dot(a.Unit, b.Unit)
	return math.acos(clamp(d, -1, 1))
end
function Vector3.new(x, y, z)
	return v3(x or 0, y or 0, z or 0)
end
function Vector3.FromNormalId(n)
	local map = { Right = v3(1, 0, 0), Left = v3(-1, 0, 0), Top = v3(0, 1, 0), Bottom = v3(0, -1, 0), Back = v3(0, 0, 1), Front = v3(0, 0, -1) }
	return map[n.Name]
end
Vector3.zero, Vector3.one = v3(0, 0, 0), v3(1, 1, 1)
Vector3.xAxis, Vector3.yAxis, Vector3.zAxis = v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)

-- Vector2 ------------------------------------------------------------------------------------
local Vector2 = {}
local V2 = {}
TYPE[V2] = "Vector2"
local function v2(x, y)
	return setmetatable({ X = x, Y = y }, V2)
end
local V2methods = {}
V2.__index = function(v, k)
	if k == "Magnitude" then
		return sqrt(v.X * v.X + v.Y * v.Y)
	elseif k == "Unit" then
		local m = sqrt(v.X * v.X + v.Y * v.Y)
		return m == 0 and v2(0, 0) or v2(v.X / m, v.Y / m)
	end
	local m = V2methods[k]
	if m then
		return m
	end
	error(tostring(k) .. " is not a valid member of Vector2", 2)
end
V2.__newindex = readonly("Vector2")
V2.__add = function(a, b)
	return v2(a.X + b.X, a.Y + b.Y)
end
V2.__sub = function(a, b)
	return v2(a.X - b.X, a.Y - b.Y)
end
V2.__mul = function(a, b)
	if type(a) == "number" then
		return v2(a * b.X, a * b.Y)
	elseif type(b) == "number" then
		return v2(a.X * b, a.Y * b)
	end
	return v2(a.X * b.X, a.Y * b.Y)
end
V2.__div = function(a, b)
	if type(b) == "number" then
		return v2(a.X / b, a.Y / b)
	end
	return v2(a.X / b.X, a.Y / b.Y)
end
V2.__unm = function(a)
	return v2(-a.X, -a.Y)
end
V2.__eq = function(a, b)
	return a.X == b.X and a.Y == b.Y
end
V2.__tostring = function(v)
	return fmt(v.X) .. ", " .. fmt(v.Y)
end
function V2methods.Dot(a, b)
	return a.X * b.X + a.Y * b.Y
end
function V2methods.Cross(a, b)
	return a.X * b.Y - a.Y * b.X
end
function V2methods.Lerp(a, b, t)
	return v2(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t)
end
function Vector2.new(x, y)
	return v2(x or 0, y or 0)
end
Vector2.zero, Vector2.one, Vector2.xAxis, Vector2.yAxis = v2(0, 0), v2(1, 1), v2(1, 0), v2(0, 1)

-- CFrame -------------------------------------------------------------------------------------
-- Stored as position + row-major rotation (R00..R22), the same layout as the place file.
local CFrame = {}
local CF = {}
TYPE[CF] = "CFrame"
local function cf(x, y, z, a, b, c, d, e, f, g, h, i)
	return setmetatable({ x, y, z, a, b, c, d, e, f, g, h, i }, CF)
end
local CFmethods = {}
CF.__index = function(m, k)
	if k == "Position" or k == "p" then
		return v3(m[1], m[2], m[3])
	elseif k == "X" then
		return m[1]
	elseif k == "Y" then
		return m[2]
	elseif k == "Z" then
		return m[3]
	elseif k == "LookVector" or k == "lookVector" then
		return v3(-m[6], -m[9], -m[12])
	elseif k == "RightVector" or k == "rightVector" then
		return v3(m[4], m[7], m[10])
	elseif k == "UpVector" or k == "upVector" then
		return v3(m[5], m[8], m[11])
	elseif k == "XVector" then
		return v3(m[4], m[7], m[10])
	elseif k == "YVector" then
		return v3(m[5], m[8], m[11])
	elseif k == "ZVector" then
		return v3(m[6], m[9], m[12])
	elseif k == "Rotation" then
		return cf(0, 0, 0, m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12])
	end
	local f = CFmethods[k]
	if f then
		return f
	end
	error(tostring(k) .. " is not a valid member of CFrame", 2)
end
CF.__newindex = readonly("CFrame")
local function cfmul(a, b)
	local a4, a5, a6, a7, a8, a9, a10, a11, a12 = a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12]
	local b4, b5, b6, b7, b8, b9, b10, b11, b12 = b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12]
	return cf(
		a[1] + a4 * b[1] + a5 * b[2] + a6 * b[3],
		a[2] + a7 * b[1] + a8 * b[2] + a9 * b[3],
		a[3] + a10 * b[1] + a11 * b[2] + a12 * b[3],
		a4 * b4 + a5 * b7 + a6 * b10, a4 * b5 + a5 * b8 + a6 * b11, a4 * b6 + a5 * b9 + a6 * b12,
		a7 * b4 + a8 * b7 + a9 * b10, a7 * b5 + a8 * b8 + a9 * b11, a7 * b6 + a8 * b9 + a9 * b12,
		a10 * b4 + a11 * b7 + a12 * b10, a10 * b5 + a11 * b8 + a12 * b11, a10 * b6 + a11 * b9 + a12 * b12
	)
end
local function cfpoint(a, v)
	return v3(
		a[1] + a[4] * v.X + a[5] * v.Y + a[6] * v.Z,
		a[2] + a[7] * v.X + a[8] * v.Y + a[9] * v.Z,
		a[3] + a[10] * v.X + a[11] * v.Y + a[12] * v.Z
	)
end
local function cfinv(a)
	local x, y, z = a[1], a[2], a[3]
	local r00, r01, r02, r10, r11, r12, r20, r21, r22 = a[4], a[7], a[10], a[5], a[8], a[11], a[6], a[9], a[12]
	return cf(
		-(r00 * x + r01 * y + r02 * z), -(r10 * x + r11 * y + r12 * z), -(r20 * x + r21 * y + r22 * z),
		r00, r01, r02, r10, r11, r12, r20, r21, r22
	)
end
CF.__mul = function(a, b)
	if getmetatable(b) == V3 then
		return cfpoint(a, b)
	end
	return cfmul(a, b)
end
CF.__add = function(a, v)
	return cf(a[1] + v.X, a[2] + v.Y, a[3] + v.Z, unpack(a, 4, 12))
end
CF.__sub = function(a, v)
	return cf(a[1] - v.X, a[2] - v.Y, a[3] - v.Z, unpack(a, 4, 12))
end
CF.__eq = function(a, b)
	for i = 1, 12 do
		if a[i] ~= b[i] then
			return false
		end
	end
	return true
end
CF.__tostring = function(m)
	local parts = {}
	for i = 1, 12 do
		parts[i] = fmt(m[i])
	end
	return table.concat(parts, ", ")
end

local function toQuat(m)
	local r00, r01, r02, r10, r11, r12, r20, r21, r22 = m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12]
	local tr = r00 + r11 + r22
	local qw, qx, qy, qz
	if tr > 0 then
		local s = sqrt(tr + 1) * 2
		qw, qx, qy, qz = 0.25 * s, (r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s
	elseif r00 > r11 and r00 > r22 then
		local s = sqrt(1 + r00 - r11 - r22) * 2
		qw, qx, qy, qz = (r21 - r12) / s, 0.25 * s, (r01 + r10) / s, (r02 + r20) / s
	elseif r11 > r22 then
		local s = sqrt(1 + r11 - r00 - r22) * 2
		qw, qx, qy, qz = (r02 - r20) / s, (r01 + r10) / s, 0.25 * s, (r12 + r21) / s
	else
		local s = sqrt(1 + r22 - r00 - r11) * 2
		qw, qx, qy, qz = (r10 - r01) / s, (r02 + r20) / s, (r12 + r21) / s, 0.25 * s
	end
	return qx, qy, qz, qw
end
local function fromQuat(x, y, z, qx, qy, qz, qw)
	local n = sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
	if n == 0 then
		return cf(x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	end
	qx, qy, qz, qw = qx / n, qy / n, qz / n, qw / n
	return cf(x, y, z,
		1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
		2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
		2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy))
end
local function rx(a)
	local c, s = cos(a), sin(a)
	return cf(0, 0, 0, 1, 0, 0, 0, c, -s, 0, s, c)
end
local function ry(a)
	local c, s = cos(a), sin(a)
	return cf(0, 0, 0, c, 0, s, 0, 1, 0, -s, 0, c)
end
local function rz(a)
	local c, s = cos(a), sin(a)
	return cf(0, 0, 0, c, -s, 0, s, c, 0, 0, 0, 1)
end
local IDENTITY = cf(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1)

local function lookAt(at, target, up)
	up = up or v3(0, 1, 0)
	local look = (target - at)
	if look.Magnitude < 1e-9 then
		return cf(at.X, at.Y, at.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	end
	look = look.Unit
	local right = V3methods.Cross(look, up)
	if right.Magnitude < 1e-6 then
		right = V3methods.Cross(look, v3(0, 0, 1))
	end
	right = right.Unit
	local newUp = V3methods.Cross(right, look)
	return cf(at.X, at.Y, at.Z, right.X, newUp.X, -look.X, right.Y, newUp.Y, -look.Y, right.Z, newUp.Z, -look.Z)
end

function CFrame.new(...)
	local n = select("#", ...)
	local a, b, c = ...
	if n == 0 then
		return IDENTITY
	elseif n == 1 then
		return cf(a.X, a.Y, a.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	elseif n == 2 then
		return lookAt(a, b)
	elseif n == 3 then
		return cf(a, b, c, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	elseif n == 7 then
		local x, y, z, qx, qy, qz, qw = ...
		return fromQuat(x, y, z, qx, qy, qz, qw)
	elseif n == 12 then
		return cf(...)
	end
	error("Invalid number of arguments: " .. n, 2)
end
CFrame.lookAt = lookAt
function CFrame.fromEulerAnglesXYZ(x, y, z)
	return cfmul(cfmul(rx(x), ry(y)), rz(z))
end
CFrame.Angles = CFrame.fromEulerAnglesXYZ
function CFrame.fromEulerAnglesYXZ(x, y, z)
	return cfmul(cfmul(ry(y), rx(x)), rz(z))
end
CFrame.fromOrientation = CFrame.fromEulerAnglesYXZ
function CFrame.fromEulerAngles(x, y, z, order)
	return CFrame.fromEulerAnglesXYZ(x, y, z)
end
function CFrame.fromAxisAngle(axis, angle)
	local u = axis.Unit
	local s = sin(angle / 2)
	return fromQuat(0, 0, 0, u.X * s, u.Y * s, u.Z * s, cos(angle / 2))
end
function CFrame.fromMatrix(pos, vx, vy, vz)
	vz = vz or V3methods.Cross(vx, vy).Unit
	return cf(pos.X, pos.Y, pos.Z, vx.X, vy.X, vz.X, vx.Y, vy.Y, vz.Y, vx.Z, vy.Z, vz.Z)
end
CFrame.identity = IDENTITY

function CFmethods.Inverse(a)
	return cfinv(a)
end
function CFmethods.Lerp(a, b, t)
	local ax, ay, az, aw = toQuat(a)
	local bx, by, bz, bw = toQuat(b)
	local d = ax * bx + ay * by + az * bz + aw * bw
	if d < 0 then
		bx, by, bz, bw, d = -bx, -by, -bz, -bw, -d
	end
	local k0, k1
	if d > 0.9995 then
		k0, k1 = 1 - t, t
	else
		local th = math.acos(d)
		local s = sin(th)
		k0, k1 = sin((1 - t) * th) / s, sin(t * th) / s
	end
	return fromQuat(
		a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t,
		ax * k0 + bx * k1, ay * k0 + by * k1, az * k0 + bz * k1, aw * k0 + bw * k1
	)
end
function CFmethods.ToWorldSpace(a, b)
	return cfmul(a, b)
end
function CFmethods.ToObjectSpace(a, b)
	return cfmul(cfinv(a), b)
end
function CFmethods.PointToWorldSpace(a, v)
	return cfpoint(a, v)
end
function CFmethods.PointToObjectSpace(a, v)
	return cfpoint(cfinv(a), v)
end
function CFmethods.VectorToWorldSpace(a, v)
	return cfpoint(cf(0, 0, 0, unpack(a, 4, 12)), v)
end
function CFmethods.VectorToObjectSpace(a, v)
	return cfpoint(cfinv(cf(0, 0, 0, unpack(a, 4, 12))), v)
end
function CFmethods.GetComponents(a)
	return unpack(a, 1, 12)
end
CFmethods.components = CFmethods.GetComponents
function CFmethods.ToEulerAnglesXYZ(a)
	local y = asin(clamp(a[6], -1, 1))
	return atan2(-a[9], a[12]), y, atan2(-a[5], a[4])
end
function CFmethods.ToEulerAnglesYXZ(a)
	local x = asin(clamp(-a[9], -1, 1))
	return x, atan2(a[6], a[12]), atan2(a[7], a[8])
end
CFmethods.ToOrientation = CFmethods.ToEulerAnglesYXZ
function CFmethods.ToAxisAngle(a)
	local qx, qy, qz, qw = toQuat(a)
	local angle = 2 * math.acos(clamp(qw, -1, 1))
	local s = sqrt(1 - qw * qw)
	if s < 1e-6 then
		return v3(1, 0, 0), 0
	end
	return v3(qx / s, qy / s, qz / s), angle
end
function CFmethods.Orthonormalize(a)
	return a
end
function CFmethods.FuzzyEq(a, b, eps)
	eps = eps or 1e-5
	for i = 1, 12 do
		if abs(a[i] - b[i]) > eps then
			return false
		end
	end
	return true
end

-- Color3 -------------------------------------------------------------------------------------
local Color3 = {}
local C3 = {}
TYPE[C3] = "Color3"
local function c3(r, g, b)
	return setmetatable({ R = r, G = g, B = b }, C3)
end
local C3methods = {}
C3.__index = function(c, k)
	if k == "r" then
		return c.R
	elseif k == "g" then
		return c.G
	elseif k == "b" then
		return c.B
	end
	local m = C3methods[k]
	if m then
		return m
	end
	error(tostring(k) .. " is not a valid member of Color3", 2)
end
C3.__newindex = readonly("Color3")
C3.__eq = function(a, b)
	return a.R == b.R and a.G == b.G and a.B == b.B
end
C3.__tostring = function(c)
	return fmt(c.R) .. ", " .. fmt(c.G) .. ", " .. fmt(c.B)
end
function C3methods.Lerp(a, b, t)
	return c3(a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t)
end
function C3methods.ToHSV(c)
	local r, g, b = c.R, c.G, c.B
	local mx, mn = max(r, g, b), min(r, g, b)
	local d = mx - mn
	local h = 0
	if d > 0 then
		if mx == r then
			h = ((g - b) / d) % 6
		elseif mx == g then
			h = (b - r) / d + 2
		else
			h = (r - g) / d + 4
		end
		h /= 6
	end
	return h, mx == 0 and 0 or d / mx, mx
end
function C3methods.ToHex(c)
	return string.format("%02X%02X%02X", math.round(c.R * 255), math.round(c.G * 255), math.round(c.B * 255))
end
function Color3.new(r, g, b)
	return c3(r or 0, g or 0, b or 0)
end
function Color3.fromRGB(r, g, b)
	return c3((r or 0) / 255, (g or 0) / 255, (b or 0) / 255)
end
function Color3.fromHSV(h, s, v)
	local i = floor(h * 6)
	local f = h * 6 - i
	local p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
	i %= 6
	if i == 0 then
		return c3(v, t, p)
	elseif i == 1 then
		return c3(q, v, p)
	elseif i == 2 then
		return c3(p, v, t)
	elseif i == 3 then
		return c3(p, q, v)
	elseif i == 4 then
		return c3(t, p, v)
	end
	return c3(v, p, q)
end
function Color3.fromHex(hex)
	hex = string.gsub(hex, "#", "")
	return Color3.fromRGB(tonumber(string.sub(hex, 1, 2), 16), tonumber(string.sub(hex, 3, 4), 16), tonumber(string.sub(hex, 5, 6), 16))
end
Color3.toHSV = C3methods.ToHSV

-- BrickColor (common palette) ----------------------------------------------------------------
local PALETTE = {
	{ "White", 242, 243, 243 }, { "Institutional white", 248, 248, 248 }, { "Medium stone grey", 163, 162, 165 },
	{ "Dark stone grey", 99, 95, 98 }, { "Really black", 17, 17, 17 }, { "Black", 27, 42, 53 }, { "Bright red", 196, 40, 28 },
	{ "Really red", 255, 0, 0 }, { "Bright blue", 13, 105, 172 }, { "Really blue", 0, 0, 255 }, { "Bright green", 75, 151, 75 },
	{ "Lime green", 0, 255, 0 }, { "Bright yellow", 245, 205, 48 }, { "New Yeller", 255, 255, 0 }, { "Bright orange", 218, 133, 65 },
	{ "Deep orange", 255, 176, 0 }, { "Hot pink", 255, 0, 191 }, { "Royal purple", 98, 37, 209 }, { "Bright violet", 107, 50, 124 },
	{ "Cyan", 4, 175, 236 }, { "Toothpaste", 0, 255, 255 }, { "Reddish brown", 105, 64, 40 }, { "Brown", 124, 92, 70 },
	{ "Sand green", 120, 144, 130 }, { "Light stone grey", 229, 228, 223 }, { "Earth green", 39, 70, 45 }, { "Pastel blue", 128, 187, 219 },
	{ "Gold", 239, 184, 56 }, { "Teal", 18, 238, 212 }, { "Magenta", 170, 0, 170 }, { "Persimmon", 253, 234, 141 },
}
local BrickColor = {}
local BC = {}
TYPE[BC] = "BrickColor"
BC.__index = function(b, k)
	if k == "r" then
		return b.Color.R
	elseif k == "g" then
		return b.Color.G
	elseif k == "b" then
		return b.Color.B
	end
	error(tostring(k) .. " is not a valid member of BrickColor", 2)
end
BC.__newindex = readonly("BrickColor")
BC.__eq = function(a, b)
	return a.Name == b.Name
end
BC.__tostring = function(b)
	return b.Name
end
local function brick(entry, index)
	return setmetatable({ Name = entry[1], Number = index, Color = Color3.fromRGB(entry[2], entry[3], entry[4]) }, BC)
end
local function nearestBrick(r, g, b)
	local best, bestD = 1, math.huge
	for i, e in PALETTE do
		local d = (e[2] / 255 - r) ^ 2 + (e[3] / 255 - g) ^ 2 + (e[4] / 255 - b) ^ 2
		if d < bestD then
			best, bestD = i, d
		end
	end
	return brick(PALETTE[best], best)
end
function BrickColor.new(a, g, b)
	if type(a) == "string" then
		for i, e in PALETTE do
			if e[1] == a then
				return brick(e, i)
			end
		end
		return brick(PALETTE[3], 3)
	elseif getmetatable(a) == C3 then
		return nearestBrick(a.R, a.G, a.B)
	elseif g then
		return nearestBrick(a, g, b)
	end
	return brick(PALETTE[((a or 1) - 1) % #PALETTE + 1], ((a or 1) - 1) % #PALETTE + 1)
end
BrickColor.palette = BrickColor.new
function BrickColor.random()
	local i = math.random(1, #PALETTE)
	return brick(PALETTE[i], i)
end
BrickColor.Random = BrickColor.random
for _, n in { "White", "Gray", "DarkGray", "Black", "Red", "Yellow", "Green", "Blue" } do
	local names = { White = "White", Gray = "Medium stone grey", DarkGray = "Dark stone grey", Black = "Black", Red = "Bright red", Yellow = "Bright yellow", Green = "Bright green", Blue = "Bright blue" }
	BrickColor[n] = function()
		return BrickColor.new(names[n])
	end
end

-- UDim / UDim2 -------------------------------------------------------------------------------
local UDim, UDim2 = {}, {}
local UD, U2 = {}, {}
TYPE[UD], TYPE[U2] = "UDim", "UDim2"
local function ud(s, o)
	return setmetatable({ Scale = s, Offset = o }, UD)
end
UD.__index = function(_, k)
	error(tostring(k) .. " is not a valid member of UDim", 2)
end
UD.__newindex = readonly("UDim")
UD.__add = function(a, b)
	return ud(a.Scale + b.Scale, a.Offset + b.Offset)
end
UD.__sub = function(a, b)
	return ud(a.Scale - b.Scale, a.Offset - b.Offset)
end
UD.__eq = function(a, b)
	return a.Scale == b.Scale and a.Offset == b.Offset
end
UD.__tostring = function(u)
	return fmt(u.Scale) .. ", " .. fmt(u.Offset)
end
function UDim.new(s, o)
	return ud(s or 0, o or 0)
end
local function u2(xs, xo, ys, yo)
	return setmetatable({ X = ud(xs, xo), Y = ud(ys, yo) }, U2)
end
local U2methods = {}
U2.__index = function(u, k)
	if k == "Width" then
		return u.X
	elseif k == "Height" then
		return u.Y
	end
	local m = U2methods[k]
	if m then
		return m
	end
	error(tostring(k) .. " is not a valid member of UDim2", 2)
end
U2.__newindex = readonly("UDim2")
U2.__add = function(a, b)
	return u2(a.X.Scale + b.X.Scale, a.X.Offset + b.X.Offset, a.Y.Scale + b.Y.Scale, a.Y.Offset + b.Y.Offset)
end
U2.__sub = function(a, b)
	return u2(a.X.Scale - b.X.Scale, a.X.Offset - b.X.Offset, a.Y.Scale - b.Y.Scale, a.Y.Offset - b.Y.Offset)
end
U2.__unm = function(a)
	return u2(-a.X.Scale, -a.X.Offset, -a.Y.Scale, -a.Y.Offset)
end
U2.__eq = function(a, b)
	return a.X == b.X and a.Y == b.Y
end
U2.__tostring = function(u)
	return "{" .. tostring(u.X) .. "}, {" .. tostring(u.Y) .. "}"
end
function U2methods.Lerp(a, b, t)
	local function l(p, q)
		return p + (q - p) * t
	end
	return u2(l(a.X.Scale, b.X.Scale), l(a.X.Offset, b.X.Offset), l(a.Y.Scale, b.Y.Scale), l(a.Y.Offset, b.Y.Offset))
end
function UDim2.new(a, b, c, d)
	if getmetatable(a) == UD then
		return u2(a.Scale, a.Offset, b.Scale, b.Offset)
	end
	return u2(a or 0, b or 0, c or 0, d or 0)
end
function UDim2.fromScale(x, y)
	return u2(x or 0, 0, y or 0, 0)
end
function UDim2.fromOffset(x, y)
	return u2(0, x or 0, 0, y or 0)
end

-- NumberRange / NumberSequence / ColorSequence (values only) ---------------------------------
local NumberRange = {}
local NR = { __tostring = function(r)
	return fmt(r.Min) .. " " .. fmt(r.Max)
end }
TYPE[NR] = "NumberRange"
NR.__newindex = readonly("NumberRange")
NR.__eq = function(a, b)
	return a.Min == b.Min and a.Max == b.Max
end
function NumberRange.new(a, b)
	return setmetatable({ Min = a, Max = b or a }, NR)
end

local NumberSequenceKeypoint, NumberSequence = {}, {}
local NSK = { __tostring = function(k)
	return fmt(k.Time) .. " " .. fmt(k.Value) .. " " .. fmt(k.Envelope)
end }
NSK.__newindex = readonly("NumberSequenceKeypoint")
TYPE[NSK] = "NumberSequenceKeypoint"
function NumberSequenceKeypoint.new(t, v, e)
	return setmetatable({ Time = t, Value = v, Envelope = e or 0 }, NSK)
end
local NS = { __tostring = function(s)
	local parts = {}
	for i, k in s.Keypoints do
		parts[i] = tostring(k)
	end
	return table.concat(parts, " ")
end }
NS.__newindex = readonly("NumberSequence")
TYPE[NS] = "NumberSequence"
local function numberSequence(keypoints)
	return setmetatable({ Keypoints = table.freeze(keypoints) }, NS)
end
function NumberSequence.new(a, b)
	if type(a) == "number" then
		return numberSequence({ NumberSequenceKeypoint.new(0, a), NumberSequenceKeypoint.new(1, b or a) })
	end
	if type(a) ~= "table" or #a < 2 then
		error("NumberSequence.new: expected a number or at least 2 keypoints", 2)
	end
	if a[1].Time ~= 0 or a[#a].Time ~= 1 then
		error("NumberSequence: must start at time 0 and end at time 1", 2)
	end
	return numberSequence(table.clone(a))
end

local ColorSequenceKeypoint, ColorSequence = {}, {}
local CSK = { __tostring = function(k)
	return fmt(k.Time) .. " " .. tostring(k.Value)
end }
CSK.__newindex = readonly("ColorSequenceKeypoint")
TYPE[CSK] = "ColorSequenceKeypoint"
function ColorSequenceKeypoint.new(t, c)
	return setmetatable({ Time = t, Value = c }, CSK)
end
local CS = { __tostring = NS.__tostring }
CS.__newindex = readonly("ColorSequence")
TYPE[CS] = "ColorSequence"
local function colorSequence(keypoints)
	return setmetatable({ Keypoints = table.freeze(keypoints) }, CS)
end
function ColorSequence.new(a, b)
	if type(a) == "table" and getmetatable(a) == nil then
		if #a < 2 then
			error("ColorSequence.new: expected at least 2 keypoints", 2)
		end
		return colorSequence(table.clone(a))
	end
	return colorSequence({ ColorSequenceKeypoint.new(0, a), ColorSequenceKeypoint.new(1, b or a) })
end

-- Rect -----------------------------------------------------------------------------------------
local Rect = {}
local RC = { __tostring = function(r)
	return fmt(r.Min.X) .. ", " .. fmt(r.Min.Y) .. ", " .. fmt(r.Max.X) .. ", " .. fmt(r.Max.Y)
end }
RC.__index = function(r, k)
	if k == "Width" then
		return r.Max.X - r.Min.X
	elseif k == "Height" then
		return r.Max.Y - r.Min.Y
	end
	return nil
end
RC.__newindex = readonly("Rect")
TYPE[RC] = "Rect"
function Rect.new(a, b, c, d)
	if type(a) == "number" then
		return setmetatable({ Min = v2(a, b), Max = v2(c, d) }, RC)
	end
	return setmetatable({ Min = a or v2(0, 0), Max = b or v2(0, 0) }, RC)
end

-- Font -----------------------------------------------------------------------------------------
local Font = {}
local FT = { __tostring = function(f)
	return string.format("Font { Family = %s, Weight = %s, Style = %s }", f.Family, f.Weight.Name, f.Style.Name)
end }
FT.__newindex = readonly("Font")
TYPE[FT] = "Font"

-- TweenInfo ----------------------------------------------------------------------------------
local TweenInfo = {}
local TI = { __tostring = function(t)
	return string.format("Time:%s DelayTime:%s RepeatCount:%d Reverses:%s EasingDirection:%s EasingStyle:%s", fmt(t.Time), fmt(t.DelayTime), t.RepeatCount, tostring(t.Reverses), t.EasingDirection.Name, t.EasingStyle.Name)
end }
TYPE[TI] = "TweenInfo"

-- Random -------------------------------------------------------------------------------------
local Random = {}
local RNG = {}
RNG.__index = RNG
TYPE[RNG] = "Random"
function Random.new(seed)
	local self = setmetatable({ _s = seed or floor(os.clock() * 1e6) }, RNG)
	return self
end
function RNG:_next()
	self._s = (self._s * 1103515245 + 12345) % 2147483648
	return self._s / 2147483648
end
function RNG:NextNumber(a, b)
	a, b = a or 0, b or 1
	return a + (b - a) * self:_next()
end
function RNG:NextInteger(a, b)
	return floor(a + (b - a + 1) * self:_next())
end
function RNG:NextUnitVector()
	local z = self:NextNumber(-1, 1)
	local t = self:NextNumber(0, math.pi * 2)
	local r = sqrt(1 - z * z)
	return v3(r * cos(t), r * sin(t), z)
end
function RNG:Clone()
	return setmetatable({ _s = self._s }, RNG)
end

------------------------------------------------------------------------------------------------
-- Enum
------------------------------------------------------------------------------------------------

local EI = {}
TYPE[EI] = "EnumItem"
EI.__index = function(e, k)
	if k == "IsA" then
		return function(self, typeName)
			return self.EnumType.Name == typeName
		end
	end
	error(tostring(k) .. " is not a valid member of EnumItem", 2)
end
EI.__newindex = readonly("EnumItem")
EI.__tostring = function(e)
	return "Enum." .. e.EnumType.Name .. "." .. e.Name
end
local ET = {}
TYPE[ET] = "Enum"
local enumTypes = {}
local function enumType(name)
	local t = enumTypes[name]
	if t then
		return t
	end
	local items = {}
	t = setmetatable({}, ET)
	rawset(t, "Name", name)
	rawset(t, "__name", name)
	rawset(t, "__items", items)
	enumTypes[name] = t
	return t
end
local function enumItem(typeName, itemName)
	local t = enumType(typeName)
	local items = rawget(t, "__items")
	local it = items[itemName]
	if it == nil then
		local value = H.enum(typeName, itemName)
		if value == nil then
			return nil
		end
		it = setmetatable({ Name = itemName, Value = value, EnumType = t }, EI)
		items[itemName] = it
	end
	return it
end
ET.__index = function(t, k)
	if k == "GetEnumItems" then
		return function(self)
			local flat = { H.enumitems(rawget(self, "__name")) }
			local out = {}
			for i = 1, #flat, 2 do
				table.insert(out, enumItem(rawget(self, "__name"), flat[i]))
			end
			return out
		end
	elseif k == "FromName" then
		return function(self, n)
			return enumItem(rawget(self, "__name"), n)
		end
	elseif k == "FromValue" then
		return function(self, v)
			local flat = { H.enumitems(rawget(self, "__name")) }
			for i = 1, #flat, 2 do
				if flat[i + 1] == v then
					return enumItem(rawget(self, "__name"), flat[i])
				end
			end
			return nil
		end
	end
	local it = enumItem(rawget(t, "__name"), k)
	if it == nil then
		error(tostring(k) .. " is not a valid member of \"Enum." .. rawget(t, "__name") .. "\"", 2)
	end
	return it
end
ET.__newindex = readonly("Enum")
ET.__tostring = function(t)
	return rawget(t, "__name")
end
local Enum = setmetatable({}, {
	__index = function(_, k)
		if H.enum(k, nil) == nil then
			error(tostring(k) .. " is not a valid EnumItem", 2)
		end
		return enumType(k)
	end,
	__newindex = readonly("Enums"),
	__tostring = function()
		return "Enums"
	end,
})

local function font(family, weight, style)
	if type(weight) == "string" then
		weight = enumItem("FontWeight", weight)
	end
	if type(style) == "string" then
		style = enumItem("FontStyle", style)
	end
	weight = weight or Enum.FontWeight.Regular
	return setmetatable({
		Family = family,
		Weight = weight,
		Style = style or Enum.FontStyle.Normal,
		Bold = weight.Value >= 600,
	}, FT)
end
-- Enum.Font -> (family file, weight); families as stored in rbxasset://fonts/families/<File>.json.
local LEGACY_FONTS = {
	Legacy = { "LegacyArial", "Regular" }, Arial = { "Arimo", "Regular" }, ArialBold = { "Arimo", "Bold" },
	SourceSans = { "SourceSansPro", "Regular" }, SourceSansBold = { "SourceSansPro", "Bold" },
	SourceSansSemibold = { "SourceSansPro", "SemiBold" }, SourceSansLight = { "SourceSansPro", "Light" },
	SourceSansItalic = { "SourceSansPro", "Regular", "Italic" }, Gotham = { "GothamSSm", "Regular" },
	GothamMedium = { "GothamSSm", "Medium" }, GothamBold = { "GothamSSm", "Bold" }, GothamBlack = { "GothamSSm", "Heavy" },
	FredokaOne = { "FredokaOne", "Regular" }, LuckiestGuy = { "LuckiestGuy", "Regular" }, Cartoon = { "ComicNeueAngular", "Regular" },
	Arcade = { "PressStart2P", "Regular" }, Code = { "Inconsolata", "Regular" }, Bangers = { "Bangers", "Regular" },
}
function Font.new(family, weight, style)
	return font(family, weight, style)
end
function Font.fromName(name, weight, style)
	return font("rbxasset://fonts/families/" .. name .. ".json", weight, style)
end
function Font.fromId(id, weight, style)
	return font("rbxassetid://" .. tostring(id), weight, style)
end
function Font.fromEnum(item)
	local spec = LEGACY_FONTS[item and item.Name or "SourceSans"] or { item.Name, "Regular" }
	return font("rbxasset://fonts/families/" .. spec[1] .. ".json", spec[2], spec[3])
end

function TweenInfo.new(time, style, direction, repeatCount, reverses, delayTime)
	return setmetatable({
		Time = time or 1,
		EasingStyle = style or Enum.EasingStyle.Quad,
		EasingDirection = direction or Enum.EasingDirection.Out,
		RepeatCount = repeatCount or 0,
		Reverses = reverses or false,
		DelayTime = delayTime or 0,
	}, TI)
end

------------------------------------------------------------------------------------------------
-- Signals (RBXScriptSignal / RBXScriptConnection)
------------------------------------------------------------------------------------------------

local Signal = {}
Signal.__index = Signal
TYPE[Signal] = "RBXScriptSignal"
Signal.__tostring = function()
	return "Signal"
end
local Connection = {}
Connection.__index = Connection
TYPE[Connection] = "RBXScriptConnection"
Connection.__tostring = function()
	return "Connection"
end

function Signal.new(onFirstConnect)
	return setmetatable({ _c = {}, _w = {}, _first = onFirstConnect }, Signal)
end
function Signal:Connect(fn)
	if type(fn) ~= "function" then
		error("Attempt to connect failed: Passed value is not a function", 2)
	end
	if self._first then
		local f = self._first
		self._first = nil
		f()
	end
	local c = setmetatable({ Connected = true, _s = self, _f = fn }, Connection)
	table.insert(self._c, c)
	return c
end
Signal.connect = Signal.Connect
function Signal:Once(fn)
	local c
	c = self:Connect(function(...)
		c:Disconnect()
		fn(...)
	end)
	return c
end
function Signal:Wait()
	if self._first then
		local f = self._first
		self._first = nil
		f()
	end
	table.insert(self._w, currentThread())
	return coroutine.yield()
end
Signal.wait = Signal.Wait
function Signal:_fire(...)
	if #self._c > 0 then
		for _, c in table.clone(self._c) do
			if c.Connected then
				spawnThread(c._f, ...)
			end
		end
	end
	if #self._w > 0 then
		local w = self._w
		self._w = {}
		for _, co in w do
			resumeThread(co, ...)
		end
	end
end
function Connection:Disconnect()
	if not self.Connected then
		return
	end
	self.Connected = false
	local list = self._s._c
	local i = table.find(list, self)
	if i then
		table.remove(list, i)
	end
end
Connection.disconnect = Connection.Disconnect

------------------------------------------------------------------------------------------------
-- Instances: proxies over host ids
------------------------------------------------------------------------------------------------

local IM = {}
TYPE[IM] = "Instance"
local proxies = {}
local idOf = setmetatable({}, { __mode = "k" })
local events = {}
local callbacks = {}
local Methods = {}

local function wrap(id)
	if id == nil then
		return nil
	end
	local p = proxies[id]
	if not p then
		p = setmetatable({}, IM)
		proxies[id] = p
		idOf[p] = id
	end
	return p
end

local InputObject = {}
InputObject.__index = InputObject
TYPE[InputObject] = "Instance"
InputObject.__tostring = function()
	return "InputObject"
end
function InputObject:IsA(c)
	return c == "InputObject" or c == "Instance"
end

local decode
decode = function(t, i)
	local k = t[i]
	if k == "n" then
		return nil, i + 1
	elseif k == "v" then
		return t[i + 1], i + 2
	elseif k == "i" then
		return wrap(t[i + 1]), i + 2
	elseif k == "V3" then
		return v3(t[i + 1], t[i + 2], t[i + 3]), i + 4
	elseif k == "V2" then
		return v2(t[i + 1], t[i + 2]), i + 3
	elseif k == "CF" then
		return cf(unpack(t, i + 1, i + 12)), i + 13
	elseif k == "C3" then
		return c3(t[i + 1], t[i + 2], t[i + 3]), i + 4
	elseif k == "BC" then
		return nearestBrick(t[i + 1], t[i + 2], t[i + 3]), i + 4
	elseif k == "U2" then
		return u2(t[i + 1], t[i + 2], t[i + 3], t[i + 4]), i + 5
	elseif k == "UD" then
		return ud(t[i + 1], t[i + 2]), i + 3
	elseif k == "E" then
		return enumItem(t[i + 1], t[i + 2]), i + 3
	elseif k == "NR" then
		return NumberRange.new(t[i + 1], t[i + 2]), i + 3
	elseif k == "NS" then
		local n, kp = t[i + 1], {}
		for j = 0, n - 1 do
			local b = i + 2 + j * 3
			kp[j + 1] = NumberSequenceKeypoint.new(t[b], t[b + 1], t[b + 2])
		end
		return numberSequence(kp), i + 2 + n * 3
	elseif k == "CS" then
		local n, kp = t[i + 1], {}
		for j = 0, n - 1 do
			local b = i + 2 + j * 4
			kp[j + 1] = ColorSequenceKeypoint.new(t[b], c3(t[b + 1], t[b + 2], t[b + 3]))
		end
		return colorSequence(kp), i + 2 + n * 4
	elseif k == "FT" then
		return font(t[i + 1], t[i + 2], t[i + 3]), i + 4
	elseif k == "RC" then
		return Rect.new(t[i + 1], t[i + 2], t[i + 3], t[i + 4]), i + 5
	elseif k == "IO" then
		local input = setmetatable({
			KeyCode = enumItem("KeyCode", t[i + 1]) or Enum.KeyCode.Unknown,
			UserInputType = enumItem("UserInputType", t[i + 2]),
			Position = v3(t[i + 3], t[i + 4], 0),
			Delta = v3(t[i + 5], t[i + 6], 0),
			UserInputState = enumItem("UserInputState", t[i + 7]),
		}, InputObject)
		return input, i + 8
	end
	error("valor inválido vindo do host: " .. tostring(k))
end

local function decodeAll(t)
	local out, n, i = {}, 0, 1
	while i <= #t do
		local v
		v, i = decode(t, i)
		n += 1
		out[n] = v
	end
	return unpack(out, 1, n)
end

local function encode(v, level)
	local tv = type(v)
	if v == nil then
		return "n"
	elseif tv == "number" or tv == "string" or tv == "boolean" then
		return "v", v
	end
	local mt = getmetatable(v)
	if mt == IM then
		return "i", idOf[v]
	elseif mt == V3 then
		return "V3", v.X, v.Y, v.Z
	elseif mt == CF then
		return "CF", unpack(v, 1, 12)
	elseif mt == C3 then
		return "C3", v.R, v.G, v.B
	elseif mt == BC then
		return "BC", v.Color.R, v.Color.G, v.Color.B
	elseif mt == U2 then
		return "U2", v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset
	elseif mt == UD then
		return "UD", v.Scale, v.Offset
	elseif mt == V2 then
		return "V2", v.X, v.Y
	elseif mt == EI then
		return "E", v.EnumType.Name, v.Name
	elseif mt == NR then
		return "NR", v.Min, v.Max
	elseif mt == NS then
		local out = { "NS", #v.Keypoints }
		for _, kp in v.Keypoints do
			table.insert(out, kp.Time)
			table.insert(out, kp.Value)
			table.insert(out, kp.Envelope)
		end
		return unpack(out)
	elseif mt == CS then
		local out = { "CS", #v.Keypoints }
		for _, kp in v.Keypoints do
			table.insert(out, kp.Time)
			table.insert(out, kp.Value.R)
			table.insert(out, kp.Value.G)
			table.insert(out, kp.Value.B)
		end
		return unpack(out)
	elseif mt == FT then
		return "FT", v.Family, v.Weight.Name, v.Style.Name
	elseif mt == RC then
		return "RC", v.Min.X, v.Min.Y, v.Max.X, v.Max.Y
	end
	error("Unable to assign property. Value of type " .. rbxtypeof(v) .. " is not supported", (level or 2) + 1)
end

local function packArgs(...)
	local out = {}
	for i = 1, select("#", ...) do
		local r = { encode((select(i, ...)), 3) }
		for j = 1, #r do
			out[#out + 1] = r[j]
		end
	end
	return out
end

local function hostCall(self, name, ...)
	local id = idOf[self]
	if not id then
		error("Expected ':' not '.' calling member function " .. name, 3)
	end
	local args = packArgs(...)
	local r = { H.call(id, name, unpack(args)) }
	if r[1] == "x" then
		error(r[2], 3)
	end
	return decodeAll(r)
end

local function signalFor(id, name)
	local byId = events[id]
	if not byId then
		byId = {}
		events[id] = byId
	end
	local s = byId[name]
	if not s then
		s = Signal.new(function()
			H.listen(id, name)
		end)
		byId[name] = s
	end
	return s
end

local function fireLocal(id, name, ...)
	local byId = events[id]
	local s = byId and byId[name]
	if s then
		s:_fire(...)
	end
end

-- Destroyed instances (and a respawned character) lose every connection, like in Roblox.
local function dropSignals(ids, n)
	for i = 1, n do
		local id = ids[i]
		local byId = events[id]
		if byId then
			for _, s in byId do
				for _, c in s._c do
					c.Connected = false
				end
				table.clear(s._c)
			end
			events[id] = nil
		end
	end
end

local CALLBACK_PROPS = { OnServerInvoke = true, OnClientInvoke = true, OnInvoke = true, ProcessReceipt = true, OnClose = true }

IM.__index = function(self, key)
	local m = Methods[key]
	if m then
		return m
	end
	local id = idOf[self]
	local cb = callbacks[id]
	if cb and cb[key] then
		return cb[key]
	end
	local r = { H.get(id, key) }
	local kind = r[1]
	if kind == "ev" then
		return signalFor(id, key)
	elseif kind == "fn" then
		return function(this, ...)
			return hostCall(this, key, ...)
		end
	elseif kind == "x" then
		error(r[2], 2)
	end
	return (decode(r, 1))
end

local function isValueBase(id)
	return H.isa(id, "ValueBase")
end

IM.__newindex = function(self, key, value)
	local id = idOf[self]
	if CALLBACK_PROPS[key] or type(value) == "function" then
		callbacks[id] = callbacks[id] or {}
		callbacks[id][key] = value
		return
	end
	local err = H.set(id, key, encode(value, 2))
	if err then
		error(err, 2)
	end
	local byId = events[id]
	if byId then
		local changed = byId.Changed
		if changed then
			if isValueBase(id) and key == "Value" then
				changed:_fire(value)
			else
				changed:_fire(key)
			end
		end
		local prop = byId["Prop:" .. key]
		if prop then
			prop:_fire()
		end
	end
end

IM.__tostring = function(self)
	local r = { H.get(idOf[self], "Name") }
	return tostring(r[2])
end

local function childList(flat, n)
	local out = table.create(n)
	for i = 1, n do
		out[i] = wrap(flat[i])
	end
	return out
end

local function checkSelf(self, name)
	if not idOf[self] then
		error("Expected ':' not '.' calling member function " .. name, 3)
	end
	return idOf[self]
end

function Methods.GetChildren(self)
	return childList(H.childrenList(checkSelf(self, "GetChildren")))
end
Methods.getChildren = Methods.GetChildren
Methods.children = Methods.GetChildren
function Methods.GetDescendants(self)
	return childList(H.descendantsList(checkSelf(self, "GetDescendants")))
end
function Methods.FindFirstChild(self, name, recursive)
	return wrap(H.find(checkSelf(self, "FindFirstChild"), tostring(name), recursive == true, "name"))
end
Methods.findFirstChild = Methods.FindFirstChild
function Methods.FindFirstChildOfClass(self, cls)
	return wrap(H.find(checkSelf(self, "FindFirstChildOfClass"), cls, false, "class"))
end
function Methods.FindFirstChildWhichIsA(self, cls, recursive)
	return wrap(H.find(checkSelf(self, "FindFirstChildWhichIsA"), cls, recursive == true, "isa"))
end
function Methods.FindFirstDescendant(self, name)
	return wrap(H.find(checkSelf(self, "FindFirstDescendant"), name, true, "name"))
end
function Methods.FindFirstAncestor(self, name)
	return wrap(H.ancestor(checkSelf(self, "FindFirstAncestor"), name, "name"))
end
function Methods.FindFirstAncestorOfClass(self, cls)
	return wrap(H.ancestor(checkSelf(self, "FindFirstAncestorOfClass"), cls, "class"))
end
function Methods.FindFirstAncestorWhichIsA(self, cls)
	return wrap(H.ancestor(checkSelf(self, "FindFirstAncestorWhichIsA"), cls, "isa"))
end
function Methods.WaitForChild(self, name, timeout)
	local id = checkSelf(self, "WaitForChild")
	local found = H.find(id, name, false, "name")
	if found then
		return wrap(found)
	end
	local started, warned = now, false
	while true do
		task.wait()
		found = H.find(id, name, false, "name")
		if found then
			return wrap(found)
		end
		if timeout and now - started >= timeout then
			return nil
		end
		if not warned and not timeout and now - started >= 5 then
			warned = true
			H.print("warn", string.format("Infinite yield possible on '%s:WaitForChild(\"%s\")'", H.fullname(id), tostring(name)))
		end
	end
end
function Methods.IsA(self, cls)
	return H.isa(checkSelf(self, "IsA"), cls)
end
Methods.isA = Methods.IsA
function Methods.IsDescendantOf(self, other)
	local id = checkSelf(self, "IsDescendantOf")
	local target = idOf[other]
	local p = H.parent(id)
	while p ~= nil do
		if p == target then
			return true
		end
		p = H.parent(p)
	end
	return false
end
function Methods.IsAncestorOf(self, other)
	return Methods.IsDescendantOf(other, self)
end
function Methods.GetFullName(self)
	return H.fullname(checkSelf(self, "GetFullName"))
end
function Methods.Destroy(self)
	local id = checkSelf(self, "Destroy")
	fireLocal(id, "Destroying")
	local ids, n = H.descendantsList(id)
	ids[n + 1] = id
	H.destroy(id)
	dropSignals(ids, n + 1)
end
Methods.destroy = Methods.Destroy
Methods.Remove = Methods.Destroy
function Methods.ClearAllChildren(self)
	for _, c in Methods.GetChildren(self) do
		Methods.Destroy(c)
	end
end
function Methods.Clone(self)
	return wrap(H.clone(checkSelf(self, "Clone")))
end
Methods.clone = Methods.Clone
-- Attributes live on the host record (AttributesSerialize), so place-file attributes, Clone()
-- and the Stop reset all see the same values.
function Methods.GetAttribute(self, name)
	checkSelf(self, "GetAttribute")
	if type(name) ~= "string" then
		error("Argument 1 missing or nil", 2)
	end
	return hostCall(self, "__GetAttribute", name)
end
function Methods.SetAttribute(self, name, value)
	local id = checkSelf(self, "SetAttribute")
	if type(name) ~= "string" then
		error("Argument 1 missing or nil", 2)
	end
	local old = hostCall(self, "__GetAttribute", name)
	hostCall(self, "__SetAttribute", name, value)
	if old ~= value then
		fireLocal(id, "AttributeChanged", name)
		fireLocal(id, "Attr:" .. name)
	end
end
function Methods.GetAttributes(self)
	checkSelf(self, "GetAttributes")
	local flat = { hostCall(self, "__GetAttributes") }
	local out = {}
	for i = 1, #flat, 2 do
		out[flat[i]] = flat[i + 1]
	end
	return out
end

-- Tags: Instance:AddTag(tag) and CollectionService:AddTag(instance, tag) share these methods.
local function tagTarget(self, a, b, name)
	local id = checkSelf(self, name)
	if type(a) == "table" and idOf[a] then
		return a, b
	end
	return self, a
end
local function collectionId()
	return idOf[wrap(H.service("CollectionService"))]
end
function Methods.AddTag(self, a, b)
	local target, tag = tagTarget(self, a, b, "AddTag")
	if type(tag) ~= "string" then
		error("Argument 2 missing or nil", 2)
	end
	if hostCall(target, "__AddTag", tag) then
		fireLocal(collectionId(), "TagAdded:" .. tag, target)
	end
end
function Methods.RemoveTag(self, a, b)
	local target, tag = tagTarget(self, a, b, "RemoveTag")
	if type(tag) ~= "string" then
		error("Argument 2 missing or nil", 2)
	end
	if hostCall(target, "__RemoveTag", tag) then
		fireLocal(collectionId(), "TagRemoved:" .. tag, target)
	end
end
function Methods.HasTag(self, a, b)
	local target, tag = tagTarget(self, a, b, "HasTag")
	return hostCall(target, "__HasTag", tag) == true
end
function Methods.GetTags(self, a)
	local target = tagTarget(self, a, nil, "GetTags")
	return { hostCall(target, "__GetTags") }
end
function Methods.GetTagged(self, tag)
	checkSelf(self, "GetTagged")
	return { hostCall(self, "__GetTagged", tag) }
end
function Methods.GetAllTags(self)
	checkSelf(self, "GetAllTags")
	return { hostCall(self, "__GetAllTags") }
end
function Methods.GetMarkerReachedSignal(self, name)
	return signalFor(checkSelf(self, "GetMarkerReachedSignal"), "Marker:" .. tostring(name))
end
function Methods.GetInstanceAddedSignal(self, tag)
	return signalFor(checkSelf(self, "GetInstanceAddedSignal"), "TagAdded:" .. tostring(tag))
end
function Methods.GetInstanceRemovedSignal(self, tag)
	return signalFor(checkSelf(self, "GetInstanceRemovedSignal"), "TagRemoved:" .. tostring(tag))
end
function Methods.GetAttributeChangedSignal(self, name)
	return signalFor(checkSelf(self, "GetAttributeChangedSignal"), "Attr:" .. name)
end
function Methods.GetPropertyChangedSignal(self, prop)
	local id = checkSelf(self, "GetPropertyChangedSignal")
	local r = { H.get(id, prop) }
	if r[1] == "x" or r[1] == "ev" or r[1] == "fn" then
		error(tostring(prop) .. " is not a valid property name.", 2)
	end
	return signalFor(id, "Prop:" .. prop)
end
function Methods.GetService(self, name)
	local id = H.service(name)
	if id == nil then
		error(string.format("'%s' is not a valid Service name", tostring(name)), 2)
	end
	return wrap(id)
end
Methods.getService = Methods.GetService
Methods.FindService = Methods.GetService
Methods.service = Methods.GetService

-- BindableEvent / BindableFunction / RemoteEvent / RemoteFunction: client and server share this VM.
local LOCAL_PLAYER
-- Clients may FireServer while booting, before the first step delivers __player.
local function localPlayer()
	if LOCAL_PLAYER == nil then
		local ok, p = pcall(function()
			return wrap(H.service("Players")).LocalPlayer
		end)
		if ok then
			LOCAL_PLAYER = p
		end
	end
	return LOCAL_PLAYER
end
function Methods.Fire(self, ...)
	fireLocal(checkSelf(self, "Fire"), "Event", ...)
end
function Methods.Invoke(self, ...)
	local id = checkSelf(self, "Invoke")
	local cb = callbacks[id] and callbacks[id].OnInvoke
	if not cb then
		error("OnInvoke is not set", 2)
	end
	return cb(...)
end
function Methods.FireServer(self, ...)
	fireLocal(checkSelf(self, "FireServer"), "OnServerEvent", localPlayer(), ...)
end
function Methods.FireClient(self, _player, ...)
	fireLocal(checkSelf(self, "FireClient"), "OnClientEvent", ...)
end
function Methods.FireAllClients(self, ...)
	fireLocal(checkSelf(self, "FireAllClients"), "OnClientEvent", ...)
end
function Methods.InvokeServer(self, ...)
	local id = checkSelf(self, "InvokeServer")
	local cb = callbacks[id] and callbacks[id].OnServerInvoke
	if not cb then
		error("OnServerInvoke is not set", 2)
	end
	return cb(localPlayer(), ...)
end
function Methods.InvokeClient(self, _player, ...)
	local id = checkSelf(self, "InvokeClient")
	local cb = callbacks[id] and callbacks[id].OnClientInvoke
	if not cb then
		error("OnClientInvoke is not set", 2)
	end
	return cb(...)
end

-- Humanoid
function Methods.TakeDamage(self, amount)
	local health = self.Health
	self.Health = max(0, health - (amount or 0))
end

-- Debris
function Methods.AddItem(self, item, lifetime)
	task.delay(lifetime or 10, function()
		pcall(Methods.Destroy, item)
	end)
end

-- RunService
function Methods.IsClient(self)
	return true
end
function Methods.IsServer(self)
	return true
end
function Methods.IsStudio(self)
	return true
end
function Methods.IsRunning(self)
	return true
end
function Methods.IsRunMode(self)
	return false
end
function Methods.IsEdit(self)
	return false
end
local renderSteps = {}
function Methods.BindToRenderStep(self, name, priority, fn)
	renderSteps[name] = { priority = priority, fn = fn }
end
function Methods.UnbindFromRenderStep(self, name)
	renderSteps[name] = nil
end

-- UserInputService / ContextActionService
local keysDown, buttonsDown = {}, {}
local mousePos = v2(0, 0)
local actions = {}
function Methods.IsKeyDown(self, key)
	return keysDown[key.Name] == true
end
function Methods.IsMouseButtonPressed(self, button)
	return buttonsDown[button.Name] == true
end
function Methods.GetMouseLocation(self)
	return mousePos
end
function Methods.GetKeysPressed(self)
	local out = {}
	for k in keysDown do
		table.insert(out, setmetatable({ KeyCode = enumItem("KeyCode", k) }, InputObject))
	end
	return out
end
function Methods.GetMouseButtonsPressed(self)
	local out = {}
	for k in buttonsDown do
		table.insert(out, setmetatable({ UserInputType = enumItem("UserInputType", k) }, InputObject))
	end
	return out
end
function Methods.GetConnectedGamepads(self)
	return {}
end
Methods.GetNavigationGamepads = Methods.GetConnectedGamepads
Methods.GetSupportedGamepadKeyCodes = Methods.GetConnectedGamepads
Methods.GetGamepadState = Methods.GetConnectedGamepads
function Methods.GetGamepadConnected(self)
	return false
end
function Methods.BindAction(self, name, fn, _createTouchButton, ...)
	actions[name] = { fn = fn, inputs = { ... } }
end
Methods.BindActionAtPriority = function(self, name, fn, touch, _priority, ...)
	return Methods.BindAction(self, name, fn, touch, ...)
end
function Methods.UnbindAction(self, name)
	actions[name] = nil
end

-- Players / Player
function Methods.GetPlayers(self)
	return { localPlayer() }
end
function Methods.GetPlayerFromCharacter(self, character)
	local p = localPlayer()
	if character and p and p.Character == character then
		return LOCAL_PLAYER
	end
	return nil
end
function Methods.GetPlayerByUserId(self, userId)
	local p = localPlayer()
	if p and p.UserId == userId then
		return LOCAL_PLAYER
	end
	return nil
end
local mouse
function Methods.GetMouse(self)
	if mouse then
		return mouse
	end
	local signals = {
		Button1Down = Signal.new(), Button1Up = Signal.new(), Button2Down = Signal.new(), Button2Up = Signal.new(),
		Move = Signal.new(), KeyDown = Signal.new(), KeyUp = Signal.new(), WheelForward = Signal.new(), WheelBackward = Signal.new(),
	}
	local playerId = idOf[self]
	mouse = setmetatable({}, {
		__index = function(_, k)
			if signals[k] then
				return signals[k]
			elseif k == "Hit" or k == "Target" or k == "UnitRay" then
				local r = { H.call(playerId, "MouseHit") }
				local hit, i = decode(r, 1)
				local target = decode(r, i)
				if k == "Hit" then
					return hit
				end
				return target
			elseif k == "X" then
				return mousePos.X
			elseif k == "Y" then
				return mousePos.Y
			elseif k == "Icon" then
				return ""
			end
			return nil
		end,
		__newindex = function() end,
		__tostring = function()
			return "Instance"
		end,
	})
	rawset(mouse, "__signals", signals)
	return mouse
end

-- Model / PVInstance / Humanoid movement: implemented by the host.
for _, name in { "GetPivot", "PivotTo", "MoveTo", "SetPrimaryPartCFrame", "GetPrimaryPartCFrame", "GetBoundingBox", "GetExtentsSize", "TranslateBy", "GetMass", "Play", "Stop", "Pause", "Resume", "Kick", "LoadCharacter", "ApplyImpulse", "ScaleTo", "GetScale", "LoadAnimation" } do
	Methods[name] = function(self, ...)
		return hostCall(self, name, ...)
	end
end
function Methods.GetTouchingParts(self)
	return { hostCall(self, "GetTouchingParts") }
end

local RaycastParams = {}
local RP = {}
TYPE[RP] = "RaycastParams"
function RaycastParams.new()
	return setmetatable({ FilterDescendantsInstances = {}, FilterType = Enum.RaycastFilterType.Exclude, IgnoreWater = false, CollisionGroup = "Default", RespectCanCollide = false }, RP)
end
local RR = { __tostring = function()
	return "RaycastResult"
end }
TYPE[RR] = "RaycastResult"
function Methods.Raycast(self, origin, direction, params)
	local include = false
	local filter = {}
	if params then
		include = params.FilterType.Name == "Include" or params.FilterType.Name == "Whitelist"
		filter = params.FilterDescendantsInstances or {}
	end
	local inst, pos, normal, dist, material = hostCall(self, "Raycast", origin, direction, include, unpack(filter))
	if inst == nil then
		return nil
	end
	return setmetatable({ Instance = inst, Position = pos, Normal = normal, Distance = dist, Material = material }, RR)
end

-- TweenService:Create — tweens run in step(), interpolating any lerpable property.
local tweens = {}
local EASE = {}
local function pow(x, p)
	return x ^ p
end
EASE.Linear = function(t)
	return t
end
EASE.Sine = function(t)
	return 1 - cos(t * math.pi / 2)
end
EASE.Quad = function(t)
	return t * t
end
EASE.Cubic = function(t)
	return t * t * t
end
EASE.Quart = function(t)
	return pow(t, 4)
end
EASE.Quint = function(t)
	return pow(t, 5)
end
EASE.Exponential = function(t)
	return t == 0 and 0 or pow(2, 10 * t - 10)
end
EASE.Circular = function(t)
	return 1 - sqrt(1 - t * t)
end
EASE.Back = function(t)
	local s = 1.70158
	return t * t * ((s + 1) * t - s)
end
EASE.Elastic = function(t)
	if t == 0 or t == 1 then
		return t
	end
	return -pow(2, 10 * t - 10) * sin((t * 10 - 10.75) * (2 * math.pi) / 3)
end
local function bounceOut(t)
	local n, d = 7.5625, 2.75
	if t < 1 / d then
		return n * t * t
	elseif t < 2 / d then
		t -= 1.5 / d
		return n * t * t + 0.75
	elseif t < 2.5 / d then
		t -= 2.25 / d
		return n * t * t + 0.9375
	end
	t -= 2.625 / d
	return n * t * t + 0.984375
end
EASE.Bounce = function(t)
	return 1 - bounceOut(1 - t)
end
local function ease(style, direction, t)
	local f = EASE[style] or EASE.Quad
	if direction == "In" then
		return f(t)
	elseif direction == "Out" then
		return 1 - f(1 - t)
	end
	if t < 0.5 then
		return f(t * 2) / 2
	end
	return 1 - f((1 - t) * 2) / 2
end
local function lerpValue(a, b, t)
	local ta = type(a)
	if ta == "number" then
		return a + (b - a) * t
	end
	local mt = getmetatable(a)
	if mt == V3 or mt == V2 or mt == CF or mt == C3 or mt == U2 then
		return a:Lerp(b, t)
	elseif mt == UD then
		return ud(a.Scale + (b.Scale - a.Scale) * t, a.Offset + (b.Offset - a.Offset) * t)
	end
	return t >= 1 and b or a
end

local Tween = {}
Tween.__index = function(t, k)
	if Tween[k] then
		return Tween[k]
	end
	return rawget(t, "_" .. k)
end
TYPE[Tween] = "Instance"
Tween.__tostring = function()
	return "Tween"
end
function Tween:Play()
	if self._PlaybackState == Enum.PlaybackState.Playing then
		return
	end
	if self._PlaybackState ~= Enum.PlaybackState.Paused then
		self._start = {}
		for k in self._goals do
			self._start[k] = self._Instance[k]
		end
		self._elapsed = -self._TweenInfo.DelayTime
		self._loops = 0
		self._reversed = false
	end
	self._PlaybackState = Enum.PlaybackState.Playing
	tweens[self] = true
end
function Tween:Pause()
	if self._PlaybackState == Enum.PlaybackState.Playing then
		self._PlaybackState = Enum.PlaybackState.Paused
		tweens[self] = nil
	end
end
function Tween:Cancel()
	self._PlaybackState = Enum.PlaybackState.Cancelled
	tweens[self] = nil
	self._Completed:_fire(Enum.PlaybackState.Cancelled)
end
function Tween:Destroy()
	tweens[self] = nil
end
local function stepTween(tw, dt)
	local info = tw._TweenInfo
	tw._elapsed += dt
	if tw._elapsed < 0 then
		return
	end
	local duration = max(info.Time, 1e-6)
	local alpha = min(tw._elapsed / duration, 1)
	local eased = ease(info.EasingStyle.Name, info.EasingDirection.Name, tw._reversed and 1 - alpha or alpha)
	local ok, err = pcall(function()
		for k, goal in tw._goals do
			tw._Instance[k] = lerpValue(tw._start[k], goal, eased)
		end
	end)
	if not ok then
		tweens[tw] = nil
		H.print("error", "TweenService: " .. tostring(err))
		return
	end
	if alpha >= 1 then
		if info.Reverses and not tw._reversed then
			tw._reversed = true
			tw._elapsed = 0
			return
		end
		if info.RepeatCount < 0 or tw._loops < info.RepeatCount then
			tw._loops += 1
			tw._reversed = false
			tw._elapsed = -info.DelayTime
			return
		end
		tweens[tw] = nil
		tw._PlaybackState = Enum.PlaybackState.Completed
		tw._Completed:_fire(Enum.PlaybackState.Completed)
	end
end
function Methods.Create(self, instance, info, goals)
	if not H.isa(idOf[self], "TweenService") then
		return hostCall(self, "Create", instance, info, goals)
	end
	return setmetatable({
		_Instance = instance,
		_TweenInfo = info,
		_goals = goals,
		_PlaybackState = Enum.PlaybackState.Begin,
		_Completed = Signal.new(),
	}, Tween)
end
function Methods.GetValue(self, alpha, style, direction)
	return ease(style.Name, direction.Name, alpha)
end

-- Legacy GuiObject tweens: TweenPosition / TweenSize / TweenSizeAndPosition.
local guiTweens = setmetatable({}, { __mode = "k" })
local function legacyTween(gui, goals, direction, style, time, override, callback)
	local running = guiTweens[gui]
	if running and running._PlaybackState == Enum.PlaybackState.Playing then
		if not override then
			return false
		end
		running:Cancel()
	end
	local function item(v, enumType, default)
		if type(v) == "string" then
			return Enum[enumType][v]
		end
		return v or Enum[enumType][default]
	end
	local info = TweenInfo.new(time or 1, item(style, "EasingStyle", "Quad"), item(direction, "EasingDirection", "Out"))
	local tw = Methods.Create(wrap(H.service("TweenService")), gui, info, goals)
	guiTweens[gui] = tw
	if callback then
		tw.Completed:Connect(function(state)
			callback(state == Enum.PlaybackState.Completed and Enum.TweenStatus.Completed or Enum.TweenStatus.Canceled)
		end)
	end
	tw:Play()
	return true
end
function Methods.TweenPosition(self, position, direction, style, time, override, callback)
	return legacyTween(self, { Position = position }, direction, style, time, override, callback)
end
function Methods.TweenSize(self, size, direction, style, time, override, callback)
	return legacyTween(self, { Size = size }, direction, style, time, override, callback)
end
function Methods.TweenSizeAndPosition(self, size, position, direction, style, time, override, callback)
	return legacyTween(self, { Size = size, Position = position }, direction, style, time, override, callback)
end

-- MarketplaceService: Studio-style test purchases (nothing is charged).
local ownedPasses = {}
local purchaseCount = 0
local function confirmPurchase(self, kind, assetId)
	local ok, accepted = pcall(hostCall, self, "PromptPurchaseDialog", kind, assetId)
	return ok and accepted == true
end
function Methods.GetProductInfo(self, assetId, infoType)
	return {
		Name = "Produto " .. tostring(assetId), Description = "", PriceInRobux = 0, AssetId = assetId, ProductId = assetId,
		TargetId = assetId, IconImageAssetId = 0, IsForSale = true, IsPublicDomain = false, IsLimited = false, Sales = 0,
		Creator = { Name = "Studio Lite", CreatorType = "User", CreatorTargetId = 0, Id = 0, HasVerifiedBadge = false },
		ProductType = infoType and infoType.Name or "Asset", Created = "", Updated = "", MinimumMembershipLevel = 0,
	}
end
function Methods.PromptProductPurchase(self, player, productId)
	local id = idOf[self]
	task.defer(function()
		local accepted = confirmPurchase(self, "Product", productId)
		local userId = player and player.UserId or 0
		if accepted then
			local cb = callbacks[id] and callbacks[id].ProcessReceipt
			if cb then
				purchaseCount += 1
				local ok, err = pcall(cb, {
					PlayerId = userId, ProductId = productId, PurchaseId = "studio-lite-" .. purchaseCount,
					CurrencySpent = 0, CurrencyType = Enum.CurrencyType.Robux, PlaceIdWherePurchased = 0,
				})
				if not ok then
					H.print("error", "ProcessReceipt: " .. tostring(err))
				end
			end
		end
		fireLocal(id, "PromptProductPurchaseFinished", userId, productId, accepted)
	end)
end
function Methods.PromptGamePassPurchase(self, player, passId)
	local id = idOf[self]
	task.defer(function()
		local accepted = confirmPurchase(self, "GamePass", passId)
		if accepted then
			ownedPasses[passId] = true
		end
		fireLocal(id, "PromptGamePassPurchaseFinished", player, passId, accepted)
	end)
end
function Methods.PromptPurchase(self, player, assetId)
	local id = idOf[self]
	task.defer(function()
		fireLocal(id, "PromptPurchaseFinished", player, assetId, confirmPurchase(self, "Asset", assetId))
	end)
end
function Methods.UserOwnsGamePassAsync(self, _userId, passId)
	return ownedPasses[passId] == true
end
function Methods.PlayerOwnsAsset(self, _player, _assetId)
	return false
end

function Methods.UnequipTools(self)
	local character = self.Parent
	local player = character and Methods.GetPlayerFromCharacter(nil, character)
	local backpack = player and player:FindFirstChildOfClass("Backpack")
	if not character or not backpack then
		return
	end
	for _, child in character:GetChildren() do
		if child:IsA("Tool") then
			child.Parent = backpack
		end
	end
end
function Methods.EquipTool(self, tool)
	if not (tool and tool:IsA("Tool")) or not self.Parent then
		return
	end
	Methods.UnequipTools(self)
	tool.Parent = self.Parent
end

function Methods.GetLastInputType(self)
	return Enum.UserInputType.MouseMovement
end
function Methods.GetCore(self, name)
	if name == "ChatActive" or name == "BadgesNotificationsActive" then
		return false
	end
	return nil
end
function Methods.GetCoreGuiEnabled(self, _coreGuiType)
	return true
end
function Methods.PreloadAsync(self, _content, callback)
	if callback then
		for _, item in _content do
			pcall(callback, typeof(item) == "Instance" and "" or tostring(item), Enum.AssetFetchStatus.Success)
		end
	end
end
function Methods.EnableGamepadCursor(self) end
function Methods.DisableGamepadCursor(self) end

------------------------------------------------------------------------------------------------
-- Globals
------------------------------------------------------------------------------------------------

local game = wrap(H.game())
local workspace = game:GetService("Workspace")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local runId, uisId = idOf[RunService], idOf[UserInputService]
local startClock = os.clock()

local Instance = {}
function Instance.new(className, parent)
	local id = H.new(className)
	if type(id) == "string" then
		error(id, 2)
	end
	local inst = wrap(id)
	if parent ~= nil then
		inst.Parent = parent
	end
	return inst
end
function Instance.fromExisting(other)
	return Methods.Clone(other)
end

local function argsToString(...)
	local parts = {}
	for i = 1, select("#", ...) do
		parts[i] = tostring((select(i, ...)))
	end
	return table.concat(parts, " ")
end

local function printFn(...)
	H.print("print", argsToString(...))
end
local function warnFn(...)
	H.print("warn", argsToString(...))
end

local scriptEnv -- assigned below, once the globals table exists

-- Each script gets its own global table (like Roblox), falling back to the shared Roblox globals.
local function loadScript(id, target)
	local chunk, compileError = H.chunk(id)
	if type(chunk) ~= "function" then
		return nil, compileError or chunk
	end
	setfenv(chunk, setmetatable({ script = target }, { __index = scriptEnv }))
	return chunk
end

local modules = {}
local loading = {}
local function requireFn(target)
	if type(target) == "number" then
		error("require(assetId) não é suportado no Studio Lite — use um ModuleScript do jogo", 2)
	end
	local id = idOf[target]
	if not id or not H.isa(id, "ModuleScript") then
		error("Attempted to call require with invalid argument(s).", 2)
	end
	local cached = modules[id]
	if cached then
		return cached.value
	end
	if loading[id] then
		error("Recursive require detected: " .. H.fullname(id), 2)
	end
	local chunk, compileError = loadScript(id, target)
	if not chunk then
		error("Requested module experienced an error while loading: " .. tostring(compileError), 2)
	end
	loading[id] = true
	local results = table.pack(pcall(chunk, target))
	loading[id] = nil
	if not results[1] then
		error("Requested module experienced an error while loading\n" .. tostring(results[2]), 2)
	end
	if results.n ~= 2 then
		error("Module code did not return exactly one value", 2)
	end
	modules[id] = { value = results[2] }
	return results[2]
end

-- setfenv drops Luau's safeenv, and without it a `next` traversal that inserts keys skips
-- entries (e.g. Janitor's lowercase aliases). Roblox runs scripts with safeenv, so snapshot the
-- keys of small tables when a traversal starts to keep that pattern working.
local rawnext = next
local SNAPSHOT_LIMIT = 64
local snapshots = setmetatable({}, { __mode = "k" })
local function safeNext(t, k)
	if k == nil then
		local keys, n = {}, 0
		local key = rawnext(t)
		while key ~= nil do
			n += 1
			if n > SNAPSHOT_LIMIT then
				snapshots[t] = nil
				return rawnext(t)
			end
			keys[n] = key
			key = rawnext(t, key)
		end
		if n == 0 then
			snapshots[t] = nil
			return nil
		end
		local pos = {}
		for i = 1, n do
			pos[keys[i]] = i
		end
		snapshots[t] = { keys = keys, pos = pos, n = n }
		return keys[1], rawget(t, keys[1])
	end
	local s = snapshots[t]
	local i = s and s.pos[k]
	if not i then
		return rawnext(t, k)
	end
	for j = i + 1, s.n do
		local key = s.keys[j]
		local v = rawget(t, key)
		if v ~= nil then
			return key, v
		end
	end
	snapshots[t] = nil
	return nil
end
-- Roblox datatypes and Instances are userdata; deep-copy helpers rely on type() ~= "table".
local rawtype = type
local function scriptType(v)
	local mt = getmetatable(v)
	if mt and TYPE[mt] then
		return "userdata"
	end
	return rawtype(v)
end
local function safePairs(t)
	if type(t) ~= "table" then
		error("invalid argument #1 to 'pairs' (table expected, got " .. rbxtypeof(t) .. ")", 2)
	end
	return safeNext, t, nil
end

local env = {
	next = safeNext, pairs = safePairs, type = scriptType,
	game = game, Game = game, workspace = workspace, Workspace = workspace, script = nil,
	Vector3 = Vector3, Vector2 = Vector2, CFrame = CFrame, Color3 = Color3, BrickColor = BrickColor, UDim = UDim, UDim2 = UDim2,
	NumberRange = NumberRange, NumberSequence = NumberSequence, NumberSequenceKeypoint = NumberSequenceKeypoint,
	ColorSequence = ColorSequence, ColorSequenceKeypoint = ColorSequenceKeypoint, Rect = Rect, Font = Font, TweenInfo = TweenInfo, Random = Random, Enum = Enum, Instance = Instance, RaycastParams = RaycastParams,
	task = task, typeof = rbxtypeof, print = printFn, warn = warnFn, require = requireFn,
	wait = task.wait, delay = task.delay, spawn = task.defer, Delay = task.delay, Spawn = task.defer, Wait = task.wait,
	tick = function()
		return os.time() + (os.clock() - startClock) % 1
	end,
	time = function()
		return now
	end,
	elapsedTime = function()
		return os.clock() - startClock
	end,
	shared = {},
}
env._G = {}
scriptEnv = setmetatable(env, { __index = getfenv(1) })

------------------------------------------------------------------------------------------------
-- Host entry points
------------------------------------------------------------------------------------------------

local function runScript(id)
	local chunk, compileError = loadScript(id, wrap(id))
	if not chunk then
		H.print("error", tostring(compileError))
		return
	end
	spawnThread(chunk)
end

local function handleInput(name, input, processed)
	local key, kind = input.KeyCode.Name, input.UserInputType and input.UserInputType.Name
	if name == "InputBegan" then
		if kind == "Keyboard" then
			keysDown[key] = true
		else
			buttonsDown[kind] = true
		end
	elseif name == "InputEnded" then
		if kind == "Keyboard" then
			keysDown[key] = nil
		else
			buttonsDown[kind] = nil
		end
	end
	if kind == "MouseMovement" or kind == "MouseButton1" or kind == "MouseButton2" then
		mousePos = v2(input.Position.X, input.Position.Y)
	end
	if mouse then
		local s = rawget(mouse, "__signals")
		if kind == "MouseButton1" then
			s[name == "InputBegan" and "Button1Down" or "Button1Up"]:_fire()
		elseif kind == "MouseButton2" then
			s[name == "InputBegan" and "Button2Down" or "Button2Up"]:_fire()
		elseif kind == "MouseMovement" then
			s.Move:_fire()
		end
	end
	if not processed and (name == "InputBegan" or name == "InputEnded") then
		for actionName, a in actions do
			for _, want in a.inputs do
				if want == input.KeyCode or want == input.UserInputType then
					spawnThread(a.fn, actionName, name == "InputBegan" and Enum.UserInputState.Begin or Enum.UserInputState.End, input)
				end
			end
		end
	end
end

local function step(dt, ...)
	now += dt
	frame += 1

	local q, n = hostList(...)
	if n > 0 then
		local i = 1
		while i <= n do
			local id, name, count = q[i], q[i + 1], q[i + 2]
			i += 3
			local args = {}
			for a = 1, count do
				args[a], i = decode(q, i)
			end
			if name == "__player" then
				LOCAL_PLAYER = wrap(id)
			elseif name == "__run" then
				runScript(id)
			elseif name == "__reset" then
				local ids, count = H.descendantsList(id)
				ids[count + 1] = id
				dropSignals(ids, count + 1)
			elseif id == uisId and (name == "InputBegan" or name == "InputEnded" or name == "InputChanged") then
				handleInput(name, args[1], args[2])
				fireLocal(id, name, unpack(args, 1, count))
			else
				fireLocal(id, name, unpack(args, 1, count))
			end
		end
	end

	fireLocal(runId, "Stepped", now, dt)
	fireLocal(runId, "PreSimulation", dt)
	fireLocal(runId, "PostSimulation", dt)
	fireLocal(runId, "Heartbeat", dt)
	if next(renderSteps) then
		local list = {}
		for _, r in renderSteps do
			table.insert(list, r)
		end
		table.sort(list, function(a, b)
			return a.priority < b.priority
		end)
		for _, r in list do
			spawnThread(r.fn, dt)
		end
	end
	fireLocal(runId, "RenderStepped", dt)
	fireLocal(runId, "PreRender", dt)

	if next(tweens) then
		for tw in table.clone(tweens) do
			stepTween(tw, dt)
		end
	end

	if #sleeping > 0 then
		local due, keep = {}, {}
		for _, s in sleeping do
			if s.frame < frame and s.wake <= now then
				table.insert(due, s)
			else
				table.insert(keep, s)
			end
		end
		sleeping = keep
		for _, s in due do
			if s.args then
				resumeThread(s.co, unpack(s.args, 1, s.args.n))
			else
				resumeThread(s.co, now - s.start, now)
			end
		end
	end

	local guard = 0
	while #deferred > 0 and guard < 10 do
		guard += 1
		local list = deferred
		deferred = {}
		for _, d in list do
			resumeThread(d.co, unpack(d.args, 1, d.args.n))
		end
	end
	return #sleeping
end

local function boot(...)
	local ids, n = hostList(...)
	for i = 1, n do
		runScript(ids[i])
	end
end

return step, boot
