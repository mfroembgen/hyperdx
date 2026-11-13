// Vinext PagesResponseStream is a Writable, not a ServerResponse. Express
// replaces both request/response prototypes, so preserve the stream and header
// interface supplied by Vinext before handing the objects to Express.
export function preserveNodeInterface(req: any, res: any) {
  if (typeof res.setHeaderValue !== 'function') return;
  const excluded = new Set([
    'constructor',
    'status',
    'json',
    'send',
    'redirect',
  ]);
  for (const value of [req, res]) {
    for (
      let proto = Object.getPrototypeOf(value);
      proto && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto)
    ) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (excluded.has(name) || Object.hasOwn(value, name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
        if (typeof descriptor.value === 'function') {
          Object.defineProperty(value, name, {
            configurable: true,
            writable: true,
            value: descriptor.value.bind(value),
          });
        } else if (descriptor.get || descriptor.set) {
          Object.defineProperty(value, name, {
            configurable: true,
            get: descriptor.get?.bind(value),
            set: descriptor.set?.bind(value),
          });
        }
      }
    }
  }
  req.socket ??= {
    encrypted: req.headers['x-forwarded-proto'] === 'https',
    remoteAddress: req.headers['x-forwarded-for']?.split(',')[0] ?? '127.0.0.1',
  };
  req.connection = req.socket;
  if (
    !['GET', 'HEAD'].includes(req.method) &&
    req.headers['content-length'] == null &&
    req.headers['transfer-encoding'] == null
  )
    req.headers['transfer-encoding'] = 'chunked';
  req.httpVersion ??= '1.1';
  req.httpVersionMajor ??= 1;
  req.httpVersionMinor ??= 1;
  res.socket ??= req.socket;
  res.removeHeader = (name: string) => {
    delete res.resHeaders[name.toLowerCase()];
  };
  res.hasHeader = (name: string) =>
    Object.hasOwn(res.resHeaders, name.toLowerCase());
  res.getHeaderNames = () => Object.keys(res.resHeaders);
}
