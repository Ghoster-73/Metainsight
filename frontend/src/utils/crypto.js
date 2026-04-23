const encoder = new TextEncoder();
const decoder = new TextDecoder();

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary);
}

function normalizeBase64(base64) {
  const sanitized = String(base64 || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");

  const remainder = sanitized.length % 4;
  if (remainder === 0) {
    return sanitized;
  }

  return sanitized.padEnd(sanitized.length + (4 - remainder), "=");
}

function base64ToArrayBuffer(base64) {
  const binary = window.atob(normalizeBase64(base64));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export async function generateKey(password, saltBase64) {
  const saltBuffer = saltBase64
    ? base64ToArrayBuffer(saltBase64)
    : window.crypto.getRandomValues(new Uint8Array(16)).buffer;

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );

  return {
    key,
    salt: arrayBufferToBase64(saltBuffer),
  };
}

export async function encryptText(plainText, password) {
  if (!password) {
    throw new Error("A password is required for encryption.");
  }

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const { key, salt } = await generateKey(password);
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoder.encode(plainText)
  );

  return {
    cipherText: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer),
    salt,
  };
}

export async function decryptText(cipherTextBase64, password, ivBase64, saltBase64) {
  if (!password) {
    throw new Error("A password is required for decryption.");
  }

  const { key } = await generateKey(password, saltBase64);
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(base64ToArrayBuffer(ivBase64)),
    },
    key,
    base64ToArrayBuffer(cipherTextBase64)
  );

  return decoder.decode(decryptedBuffer);
}
