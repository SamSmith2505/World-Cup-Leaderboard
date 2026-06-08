// Shared KV/file storage used by the serverless API routes (server-only).
import { createClient } from '@vercel/kv';
import fs from 'node:fs/promises';
import path from 'node:path';

const STATE_KEY = 'wc:state';
const SNAP_KEY = 'wc:snapshot';
const LOCAL_FILE = path.join('/tmp', 'wc-state.json');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const useKV = !!(KV_URL && KV_TOKEN);
const kv = useKV ? createClient({ url: KV_URL, token: KV_TOKEN }) : null;

export const EMPTY_STATE = { matches: [], advancement: {}, meta: { lastUpdated: null, lastSyncAt: null } };

async function readKey(key, fallback) {
  if (useKV) {
    const v = await kv.get(key);
    return v ?? fallback;
  }
  try {
    const all = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8'));
    return all[key] ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeKey(key, value) {
  if (useKV) { await kv.set(key, value); return; }
  let all = {};
  try { all = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')); } catch {}
  all[key] = value;
  await fs.writeFile(LOCAL_FILE, JSON.stringify(all, null, 2));
}

export const getState = () => readKey(STATE_KEY, EMPTY_STATE);
export const setState = (s) => writeKey(STATE_KEY, s);
export const getSnapshot = () => readKey(SNAP_KEY, null);
export const setSnapshot = (s) => writeKey(SNAP_KEY, s);
