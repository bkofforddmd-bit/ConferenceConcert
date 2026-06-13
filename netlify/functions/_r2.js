// Shared Cloudflare R2 client + helpers.
// R2 speaks the S3 API, so we use the AWS S3 SDK v3 pointed at the R2 endpoint.
const {
  S3Client, PutObjectCommand, GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET     = process.env.R2_BUCKET;
// The bucket's public base URL (R2.dev subdomain or your custom domain),
// e.g. https://pub-xxxx.r2.dev  — no trailing slash.
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || "").replace(/\/+$/, "");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const CATALOG_KEY     = "catalog.json";
const SUGGESTIONS_KEY = "suggestions.json";

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

// Read a JSON object from R2; return fallback if it doesn't exist yet.
async function getJSON(key, fallback) {
  try {
    const out = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await streamToString(out.Body);
    return JSON.parse(body);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return fallback;
    throw err;
  }
}

async function putJSON(key, value) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: JSON.stringify(value, null, 2),
    ContentType: "application/json",
    CacheControl: "no-cache",
  }));
}

async function putObject(key, body, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: "public, max-age=31536000",
  }));
  return `${PUBLIC_BASE}/${key}`;
}

// Create a short-lived URL the browser can PUT a file to directly.
// Returns { uploadUrl, publicUrl }.
async function presignPut(key, contentType, expiresIn = 600) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET, Key: key, ContentType: contentType,
    CacheControl: "public, max-age=31536000",
  });
  const uploadUrl = await getSignedUrl(client, cmd, { expiresIn });
  return { uploadUrl, publicUrl: `${PUBLIC_BASE}/${key}` };
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(obj),
});

module.exports = {
  client, BUCKET, PUBLIC_BASE,
  CATALOG_KEY, SUGGESTIONS_KEY,
  getJSON, putJSON, putObject, presignPut, json,
};
