export interface ModelConfig {
  modelId: string;
  version: string;
  sha256: string;
  expectedBytes: number;
  sources: {domestic: string[]; backup: string[]; githubPages: string};
  timeouts: {firstByteMs: number; idleMs: number; totalMs: number};
}

export interface ModelProgress {
  phase: 'cache' | 'connecting' | 'downloading' | 'switching' | 'verifying' | 'cached' | 'downloaded' | 'parsing' | 'ready';
  message: string;
  loaded: number;
  total: number;
  source: string;
  attempt: number;
  sourceCount: number;
  fromCache: boolean;
}

interface Options {
  baseURL: string;
  signal?: AbortSignal;
  onProgress?: (progress: ModelProgress) => void;
  fetcher?: typeof fetch;
  // null explicitly disables storage, including in tests / restricted browsers.
  cacheStorage?: CacheStorage | null;
}

export const CACHE_NAME = 'jiedong-no1-2024-dorm-models-v1';
export class ModelDownloadError extends Error {
  code: string;
  constructor(code: string, message: string) {super(message); this.name = 'ModelDownloadError'; this.code = code;}
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('模型加载已取消', 'AbortError');
}

export function validateConfig(value: unknown): ModelConfig {
  const c = value as ModelConfig;
  if (!c || !/^[a-z0-9_-]{1,40}$/i.test(c.modelId) || typeof c.version !== 'string' || !c.version.trim()
    || !/^[a-f0-9]{64}$/i.test(c.sha256) || !Number.isSafeInteger(c.expectedBytes) || c.expectedBytes < 20
    || !c.sources || !Array.isArray(c.sources.domestic) || !Array.isArray(c.sources.backup)
    || [...c.sources.domestic, ...c.sources.backup].some(x => typeof x !== 'string')
    || typeof c.sources.githubPages !== 'string' || !c.sources.githubPages.trim()
    || !c.timeouts || Object.values(c.timeouts).some(x => !Number.isFinite(x) || x < 1)
    || !['firstByteMs','idleMs','totalMs'].every(k => Number.isFinite(c.timeouts[k as keyof ModelConfig['timeouts']]))) {
    throw new ModelDownloadError('config', '模型下载配置无效');
  }
  return c;
}

export function getSources(config: ModelConfig, baseURL: string) {
  const resolve = (input: string) => {
    const u = new URL(input, baseURL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.username || u.password || (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))) {
      throw new ModelDownloadError('config', '模型源必须使用 HTTPS，且不能包含登录凭据');
    }
    u.hash = ''; return u.href;
  };
  const fallback = resolve(config.sources.githubPages);
  if (new URL(fallback).origin !== new URL(baseURL).origin) throw new ModelDownloadError('config', '最后的回退源必须是本站模型');
  const seen = new Set([fallback]);
  const sources: {url: string; label: string}[] = [];
  for (const [kind, urls] of [['国内镜像',config.sources.domestic],['备用镜像',config.sources.backup]] as const) {
    urls.filter(x => x.trim()).forEach((u, i) => {
      const url = resolve(u); if (seen.has(url)) return;
      seen.add(url); sources.push({url, label: `${kind} ${i + 1}`});
    });
  }
  return [...sources, {url: fallback, label: 'GitHub Pages'}];
}

export function cacheKey(config: ModelConfig, baseURL: string) {
  return new URL(`__model-cache__/${config.modelId}/${encodeURIComponent(config.version)}/${config.sha256.toLowerCase()}/dorm.glb`, baseURL).href;
}

async function bounded<T>(operation: Promise<T>, ms = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {return await Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('本地缓存操作超时')), ms);
  })]);} finally {clearTimeout(timer!);}
}

export async function verifyBlob(blob: Blob, config: ModelConfig) {
  if (blob.size !== config.expectedBytes) throw new ModelDownloadError('size', '模型下载不完整或文件版本不符');
  const data = await blob.arrayBuffer();
  const header = new DataView(data);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== blob.size) {
    throw new ModelDownloadError('format', '下载内容不是完整的 GLB 2.0 文件');
  }
  if (!globalThis.crypto?.subtle) throw new ModelDownloadError('integrity', '当前浏览器无法校验模型，请通过 HTTPS 访问');
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,'0')).join('');
  if (hash !== config.sha256.toLowerCase()) throw new ModelDownloadError('hash', '模型校验不一致，可能是旧版本或传输内容损坏');
}

function readableFailure(error: unknown) {
  if (error instanceof ModelDownloadError) return error.message;
  if (error instanceof TypeError) return '网络连接或跨域访问失败';
  return '数据传输失败';
}

async function downloadSource(url: string, config: ModelConfig, options: Options, update: (loaded: number, phase: ModelProgress['phase']) => void) {
  const controller = new AbortController();
  let reason: ModelDownloadError | undefined;
  const expire = (code: string, message: string) => {reason = new ModelDownloadError(code, message); controller.abort();};
  let idleTimer = setTimeout(() => expire('first-byte-timeout', '等待模型数据超时'), config.timeouts.firstByteMs);
  const totalTimer = setTimeout(() => expire('total-timeout', '当前下载源超过总时限'), config.timeouts.totalMs);
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, {once:true});
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    throwIfAborted(options.signal);
    const response = await (options.fetcher ?? fetch)(url, {
      signal: controller.signal, mode:'cors', credentials:'omit', cache:'no-store',
    });
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      throw new ModelDownloadError('http', `HTTP ${response.status}`);
    }
    if (!response.body) throw new ModelDownloadError('stream', '浏览器未提供可读取的模型数据流');
    // Total comes from the release manifest, not compressed wire Content-Length.
    // It stays truthful for gzip/Brotli responses and missing CORS-exposed headers.
    reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let loaded = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;
      loaded += value.byteLength;
      if (loaded > config.expectedBytes) throw new ModelDownloadError('size', '下载内容超过预期模型大小');
      chunks.push(value.slice().buffer as ArrayBuffer);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => expire('idle-timeout', '下载中断，长时间没有收到数据'), config.timeouts.idleMs);
      update(loaded, 'downloading');
    }
    clearTimeout(idleTimer); clearTimeout(totalTimer);
    throwIfAborted(options.signal);
    const blob = new Blob(chunks, {type:'model/gltf-binary'});
    update(loaded, 'verifying');
    await verifyBlob(blob, config);
    throwIfAborted(options.signal);
    return blob;
  } catch (error) {
    throwIfAborted(options.signal);
    throw reason ?? error;
  } finally {
    clearTimeout(idleTimer); clearTimeout(totalTimer);
    options.signal?.removeEventListener('abort', cancel);
    controller.abort();
    if (reader) {void reader.cancel().catch(() => {}); reader.releaseLock();}
  }
}

export async function loadModelBlob(config: ModelConfig, options: Options) {
  validateConfig(config); throwIfAborted(options.signal);
  const sources = getSources(config, options.baseURL);
  const key = cacheKey(config, options.baseURL);
  let cache: Cache | undefined;
  const emit = (phase: ModelProgress['phase'], message: string, loaded = 0, source = '', attempt = 0, fromCache = false) => {
    if (!options.signal?.aborted) options.onProgress?.({phase,message,loaded,total:config.expectedBytes,source,attempt,sourceCount:sources.length,fromCache});
  };
  emit('cache', '正在检查本地模型缓存…');
  try {
    const storage = options.cacheStorage === undefined ? globalThis.caches : options.cacheStorage;
    if (storage) {
      cache = await bounded(storage.open(CACHE_NAME));
      const hit = await bounded(cache.match(key));
      if (hit) {
        try {
          const blob = await bounded(hit.blob());
          await verifyBlob(blob, config); throwIfAborted(options.signal);
          emit('cached', '已读取本地模型缓存', blob.size, '本地缓存', 0, true);
          return {blob, fromCache:true, source:'本地缓存', cacheStored:true};
        } catch (error) {
          throwIfAborted(options.signal);
          // Delete only this application's invalid model entry, never user memories.
          await bounded(cache.delete(key)).catch(() => {});
        }
      }
    }
  } catch {throwIfAborted(options.signal); /* Storage denied or quota: continue without it. */}
  const failures: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    throwIfAborted(options.signal);
    const source = sources[i];
    emit('connecting', `正在连接${source.label}（${i + 1}/${sources.length}）…`, 0, source.label, i+1);
    let blob: Blob;
    try {
      blob = await downloadSource(source.url, config, options, (loaded, phase) => emit(phase,
        phase === 'verifying' ? '下载完成，正在校验模型…' : `正在从${source.label}下载…`, loaded, source.label, i+1));
    } catch (error) {
      throwIfAborted(options.signal);
      const reason = readableFailure(error);
      failures.push(`${source.label}：${reason}`);
      if (i + 1 < sources.length) emit('switching', `${source.label}：${reason}，正在切换…`, 0, source.label, i+1);
      continue;
    }
    let cacheStored = false;
    if (cache) {
      try {
        await bounded(cache.put(key, new Response(blob, {headers:{'Content-Type':'model/gltf-binary','Content-Length':String(blob.size)}})));
        cacheStored = true;
        // Keep version/hash-separated entries. Never reuse an older key. We do not
        // delete other versions here: an older open tab must not evict a newer one.
      } catch { /* Quota/private-mode errors must not fail an otherwise valid scene. */ }
    }
    throwIfAborted(options.signal);
    emit('downloaded', cacheStored ? '模型已下载并缓存' : '模型已下载（本次未能写入本地缓存）', blob.size, source.label, i+1);
    return {blob,fromCache:false,source:source.label,cacheStored};
  }
  throw new ModelDownloadError('all-sources-failed', `所有模型下载源均失败。${failures.join('；')}`);
}

export async function readModelConfig(fallback: ModelConfig, baseURL: string, signal?: AbortSignal): Promise<ModelConfig> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(cancel, 3000);
  try {
    throwIfAborted(signal);
    const response = await fetch(new URL('model-sources.json', baseURL), {cache:'no-store', signal:controller.signal, credentials:'omit'});
    if (!response.ok) throw new Error('配置暂不可用');
    const value: unknown = await response.json();
    return validateConfig(value);
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof ModelDownloadError) throw error;
    if (error instanceof SyntaxError) throw new ModelDownloadError('config', '模型下载配置不是有效的 JSON');
    // The same config is bundled at build time, so a failed small config request
    // does not prevent an existing local model cache from being used.
    return validateConfig(fallback);
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel);}
}
