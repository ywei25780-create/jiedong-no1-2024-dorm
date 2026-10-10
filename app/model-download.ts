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

// Each source reads only a small prefix until selected. Keep its original stream
// available as a fallback; never make a second (quota-consuming) GET to resume it.
function probeSource(url: string, config: ModelConfig, options: Options, retryConnection = false) {
  const controller = new AbortController();
  let reason: unknown;
  let rejectStopped!: (error: unknown) => void;
  const stopped = new Promise<never>((_, reject) => {rejectStopped = reject;});
  // A synchronous fetcher failure or cancellation can precede the first race.
  void stopped.catch(() => {});
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false;
  const chunks: ArrayBuffer[] = [];
  const received: number[] = [];
  let loaded = 0, headerChecked = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(idleTimer); clearTimeout(totalTimer); clearTimeout(retryTimer);
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener('abort', cancel);
    controller.abort();
    // A broken browser/network stack may never settle cancellation. Do not await
    // it, and do not let cleanup errors hide the download failure.
    if (reader) {
      try {void reader.cancel().catch(() => {});} catch { /* Already closed. */ }
      try {reader.releaseLock();} catch { /* Pending/broken reader. */ }
    }
  };
  const stop = (error: unknown) => {
    if (reason !== undefined || closed) return;
    reason = error; rejectStopped(error); cleanup();
  };
  const expire = (code: string, message: string) => stop(new ModelDownloadError(code, message));
  let idleTimer = setTimeout(() => expire('first-byte-timeout', '等待模型数据超时'), config.timeouts.firstByteMs);
  const totalTimer = setTimeout(() => expire('total-timeout', '当前下载源超过总时限'), config.timeouts.totalMs);
  const cancel = () => stop(new DOMException('模型加载已取消', 'AbortError'));
  options.signal?.addEventListener('abort', cancel, {once:true});
  const check = () => {
    throwIfAborted(options.signal);
    if (reason !== undefined) throw reason;
  };
  const read = async () => {
    check();
    // Reject independently of AbortController: some embedded browsers ignore
    // abort while connecting or waiting for their next response body chunk.
    const {done, value} = await Promise.race([reader!.read(), stopped]);
    check();
    if (done) {
      if (loaded !== config.expectedBytes) throw new ModelDownloadError('size', '模型下载不完整或文件版本不符');
      return true;
    }
    if (!value.byteLength) return false;
    loaded += value.byteLength;
    if (loaded > config.expectedBytes) throw new ModelDownloadError('size', '下载内容超过预期模型大小');
    chunks.push(value.slice().buffer as ArrayBuffer); received.push(loaded);
    if (!headerChecked && loaded >= 12) {
      const prefix = new Uint8Array(12); let offset = 0;
      for (const chunk of chunks) {
        const part = new Uint8Array(chunk).subarray(0, 12 - offset);
        prefix.set(part, offset); offset += part.length; if (offset === 12) break;
      }
      const header = new DataView(prefix.buffer);
      if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== config.expectedBytes) {
        throw new ModelDownloadError('format', '下载内容不是当前版本的 GLB 2.0 文件');
      }
      headerChecked = true;
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => expire('idle-timeout', '下载中断，长时间没有收到数据'), config.timeouts.idleMs);
    return false;
  };
  const ready = (async () => {
    try {
      check();
      const request = (async () => {
        for (let attempt = 0; ; attempt++) {
          check();
          try {
            const response = await (options.fetcher ?? fetch)(url, {
              signal:controller.signal, mode:'cors', credentials:'omit', cache:'no-store',
            });
            // Also clean up a response arriving after the independent race ended.
            if (closed || controller.signal.aborted || response.status !== 200) {
              try {void response.body?.cancel().catch(() => {});} catch { /* Closed body. */ }
              check();
              throw new ModelDownloadError('http', `HTTP ${response.status}`);
            }
            return response;
          } catch (error) {
            check();
            // Only Pages may reconnect once after a failed connection. Mirror
            // GETs reserve quota, so never retry them or explicit HTTP failures.
            if (!retryConnection || attempt > 0 || !(error instanceof TypeError)) throw error;
            await Promise.race([new Promise<void>(resolve => {
              retryTimer = setTimeout(resolve, Math.min(1000, config.timeouts.firstByteMs / 10));
            }), stopped]);
          }
        }
      })();
      const response = await Promise.race([request, stopped]); check();
      if (!response.body) throw new ModelDownloadError('stream', '浏览器未提供可读取的模型数据流');
      reader = response.body.getReader();
      while (loaded < Math.min(10000, config.expectedBytes)) await read();
      // A standby stream is deliberately paused, not an inactive download. Its
      // overall connection deadline still bounds how long it can remain open.
      clearTimeout(idleTimer);
    } catch (error) {stop(error); check(); throw error;}
  })();
  return {ready, cancel, async finish(update: (loaded: number, phase: ModelProgress['phase']) => void) {
    try {
      await ready; check();
      received.forEach(bytes => update(bytes, 'downloading'));
      check();
      idleTimer = setTimeout(() => expire('idle-timeout', '下载中断，长时间没有收到数据'), config.timeouts.idleMs);
      while (true) {
        const previous = loaded, done = await read();
        if (loaded !== previous) update(loaded, 'downloading');
        if (done) break;
      }
      clearTimeout(idleTimer); clearTimeout(totalTimer); check();
      const blob = new Blob(chunks, {type:'model/gltf-binary'});
      update(loaded, 'verifying');
      await verifyBlob(blob, config); check(); return blob;
    } catch (error) {stop(error); check(); throw error;} finally {cleanup();}
  }};
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
  const transfers: ReturnType<typeof probeSource>[] = [];
  type ProbeResult = {index: number; error?: unknown; ok: boolean};
  const pending = new Map<number, Promise<ProbeResult>>();
  emit('connecting', sources.length > 1 ? '正在同时试读下载源（0.01 MB）…' : '正在连接 GitHub Pages…');
  try {
    for (const [index, source] of sources.entries()) {
      throwIfAborted(options.signal);
      const transfer = probeSource(source.url, config, options, index === sources.length - 1); transfers.push(transfer);
      pending.set(index, transfer.ready.then(() => ({index, ok:true}), error => ({index, error, ok:false})));
    }
    while (pending.size) {
      throwIfAborted(options.signal);
      const candidate = await Promise.race(pending.values());
      pending.delete(candidate.index);
      const i = candidate.index, source = sources[i];
      let blob: Blob;
      try {
        if (!candidate.ok) throw candidate.error;
        blob = await transfers[i].finish((loaded, phase) => emit(phase,
          phase === 'verifying' ? '下载完成，正在校验模型…' : `正在从${source.label}下载…`, loaded, source.label, i+1));
      } catch (error) {
        throwIfAborted(options.signal);
        const reason = readableFailure(error);
        failures.push(`${source.label}：${reason}`);
        if (pending.size) {
          const remaining = [...pending.keys()];
          const next = remaining[0];
          emit('switching', `${source.label}：${reason}；正在尝试${remaining.map(index => sources[index].label).join('、')}…`, 0, sources[next].label, next+1);
        }
        continue;
      }
      // Cancel pending/no-data requests without waiting for their cancellation.
      transfers.forEach(transfer => transfer.cancel());
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
  } finally {
    transfers.forEach(transfer => transfer.cancel());
  }
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
