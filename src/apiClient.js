// Keep the public API shape unchanged. Each tab revalidates its own authenticated
// library, reuses 304 responses, and shares a single in-flight GET per session.
export function createApiClient(base, { fetcher = fetch, getSession = () => sessionStorage.getItem('consona-session') } = {}) {
  let sessionKey = null;
  let library = null;
  let etag = '';
  let generation = 0;
  let pending = null;

  function reset(session) {
    sessionKey = session;
    library = null;
    etag = '';
    pending = null;
    generation++;
  }

  return async function apiRequest(path, options = {}) {
    const session = getSession() || '';
    if (session !== sessionKey) reset(session);
    const method = (options.method || 'GET').toUpperCase();
    const isLibrary = path === '/api/library' && method === 'GET';
    const isMutation = !path.startsWith('/api/social/') && !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (isMutation) { generation++; pending = null; }
    const startedAt = generation;
    if (isLibrary && pending?.generation === startedAt && !options.signal) return pending.promise;

    const perform = async () => {
      const headers = new Headers(options.headers || {});
      if (session) headers.set('Authorization', `Bearer ${session}`);
      const previous = isLibrary ? library : null;
      if (previous && etag) headers.set('If-None-Match', etag);
      const response = await fetcher(`${base}${path}`, { ...options, headers, ...(isLibrary ? { cache: 'no-store' } : {}) });
      // Never hand another account's response to callers after logout/switching.
      if ((getSession() || '') !== session) throw new DOMException('A conta foi alterada.', 'AbortError');
      if (isLibrary && startedAt !== generation) {
        // A mutation finished while this GET was running. Read again instead of
        // allowing a late pre-edit response to overwrite the updated library.
        return apiRequest(path, options);
      }
      if (response.status === 304 && previous) return previous;
      const body = await response.json().catch(() => ({}));
      if ((getSession() || '') !== session) throw new DOMException('A conta foi alterada.', 'AbortError');
      if (isLibrary && startedAt !== generation) return apiRequest(path, options);
      if (!response.ok) {
        if (response.status === 401) reset(session);
        throw new Error(body.error || `Falha ao acessar a biblioteca (${response.status}).`);
      }
      if (isLibrary) { library = body; etag = response.headers.get('ETag') || ''; }
      // An overlapping GET may have started after the mutation began; invalidate
      // that generation too, after the write has actually completed.
      if (isMutation) { generation++; pending = null; }
      return body;
    };
    const promise = perform();
    if (isLibrary && !options.signal) {
      pending = { generation: startedAt, promise };
      try { return await promise; }
      finally { if (pending?.promise === promise) pending = null; }
    }
    return promise;
  };
}
