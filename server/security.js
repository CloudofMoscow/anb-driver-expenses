import {
  createHash,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password) {
  assertPassword(password);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function hashPasswordAsync(password) {
  assertPassword(password);
  const salt = randomBytes(16);
  const derived = await new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, value) => error ? reject(error) : resolve(value));
  });
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const [algorithm, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await new Promise((resolve, reject) => {
      scrypt(password, salt, expected.length, (error, value) => error ? reject(error) : resolve(value));
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function parseCookies(header = "") {
  return String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return cookies;
      const key = decodeURIComponent(part.slice(0, separator));
      const value = decodeURIComponent(part.slice(separator + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

export function sessionCookie(token, { secure = false, maxAgeSeconds = 60 * 60 * 24 * 30 } = {}) {
  return [
    `anb_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie({ secure = false } = {}) {
  return [
    "anb_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    "Max-Age=0"
  ].filter(Boolean).join("; ");
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length < 10) {
    throw new Error("Пароль должен содержать не менее 10 символов");
  }
  if (password.length > 256) throw new Error("Пароль слишком длинный");
}
