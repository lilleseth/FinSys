// Lagring i et (privat) GitHub-repo via REST API.
// Alle filer som skrives hit er allerede kryptert, bortsett fra finsys.json (salt og kontrollverdi).

const API = 'https://api.github.com';

export class GitHubBackend {
  constructor({ owner, repo, branch, token, basePath = '' }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || '';
    this.token = token;
    this.basePath = basePath.replace(/^\/+|\/+$/g, '');
    this.shas = new Map();
  }

  get label() {
    return `GitHub: ${this.owner}/${this.repo}${this.basePath ? '/' + this.basePath : ''}`;
  }

  path(p) {
    return this.basePath ? `${this.basePath}/${p}` : p;
  }

  async request(method, url, body) {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* ignore */ }
      const err = new Error(githubError(res.status, msg));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? {} : res.json();
  }

  // Sjekker at tokenen virker og at repoet er privat.
  async check() {
    const info = await this.request('GET', `/repos/${this.owner}/${this.repo}`);
    if (!info) throw new Error('Fant ikke repoet. Sjekk eier/navn, og at tokenen har tilgang til akkurat dette repoet.');
    if (!this.branch) this.branch = info.default_branch;
    if (info.permissions && !info.permissions.push) {
      throw new Error('Tokenen har bare lesetilgang. Gi den «Contents: Read and write».');
    }
    return { private: info.private, defaultBranch: info.default_branch };
  }

  async readText(p) {
    const full = this.path(p);
    const ref = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : '';
    const meta = await this.request('GET', `/repos/${this.owner}/${this.repo}/contents/${encodePath(full)}${ref}`);
    if (!meta) { this.shas.delete(full); return null; }
    if (Array.isArray(meta)) throw new Error(`${full} er en mappe`);
    this.shas.set(full, meta.sha);
    let b64 = meta.content;
    if (!b64 || meta.encoding === 'none') {
      // Filer over 1 MB må hentes som blob.
      const blob = await this.request('GET', `/repos/${this.owner}/${this.repo}/git/blobs/${meta.sha}`);
      b64 = blob.content;
    }
    return new TextDecoder().decode(b64ToBytes(b64));
  }

  async writeText(p, text, message) {
    const full = this.path(p);
    const body = {
      message: message || `Oppdater ${full}`,
      content: bytesToB64(new TextEncoder().encode(text)),
      ...(this.branch ? { branch: this.branch } : {}),
    };
    const sha = this.shas.get(full);
    if (sha) body.sha = sha;
    try {
      const res = await this.request('PUT', `/repos/${this.owner}/${this.repo}/contents/${encodePath(full)}`, body);
      this.shas.set(full, res.content.sha);
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        const err = new Error('Filen er endret et annet sted (f.eks. på en annen enhet). Last inn siden på nytt før du fortsetter.');
        err.conflict = true;
        throw err;
      }
      throw e;
    }
  }

  async deleteFile(p, message) {
    const full = this.path(p);
    let sha = this.shas.get(full);
    if (!sha) {
      const ref = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : '';
      const meta = await this.request('GET', `/repos/${this.owner}/${this.repo}/contents/${encodePath(full)}${ref}`);
      if (!meta) return;
      sha = meta.sha;
    }
    await this.request('DELETE', `/repos/${this.owner}/${this.repo}/contents/${encodePath(full)}`, {
      message: message || `Slett ${full}`,
      sha,
      ...(this.branch ? { branch: this.branch } : {}),
    });
    this.shas.delete(full);
  }
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function b64ToBytes(b64) {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function githubError(status, msg) {
  if (status === 401) return 'Tokenen er ugyldig eller utløpt. Lag en ny token på GitHub.';
  if (status === 403) return `GitHub nektet tilgang (${msg || '403'}). Sjekk at tokenen har «Contents: Read and write» for data-repoet.`;
  return `GitHub-feil ${status}: ${msg}`;
}
