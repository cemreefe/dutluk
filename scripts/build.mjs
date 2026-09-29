import { readFile, writeFile, mkdir, cp } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const config = JSON.parse(await readFile(new URL("projects.json", root), "utf8"));
const out = new URL("_site/", root);
const token = process.env.GITHUB_TOKEN;
const now = new Date();

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return res.json();
}

async function listRepos(owner) {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/users/${owner}/repos?per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) return repos;
  }
}

async function readCname(repo) {
  const url = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/CNAME`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.text()).split("\n")[0].trim().toLowerCase() || null;
}

async function isUp(domain) {
  try {
    const res = await fetch(`https://${domain}/`, { redirect: "follow", signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}

function titleFromDomain(domain) {
  return domain
    .split(".")[0]
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function ago(iso) {
  const days = Math.floor((now - new Date(iso)) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const repos = (await listRepos(config.owner)).filter((r) => !r.fork && !r.private);
const byName = new Map(repos.map((r) => [r.name, r]));
const cnames = await Promise.all(repos.map(readCname));

const projects = new Map();
repos.forEach((repo, i) => {
  const domain = cnames[i];
  if (!domain || !domain.endsWith(`.${config.domain}`)) return;
  projects.set(domain, { domain, repo });
});
for (const extra of config.extra) {
  const existing = projects.get(extra.domain);
  projects.set(extra.domain, { ...existing, ...extra, repo: existing?.repo ?? byName.get(extra.repo) });
}
for (const domain of config.hide) projects.delete(domain);

const list = await Promise.all(
  [...projects.values()].map(async (p) => {
    const o = config.overrides[p.domain] ?? {};
    const retired = config.retired.includes(p.domain);
    return {
      domain: p.domain,
      name: o.name ?? p.name ?? titleFromDomain(p.domain),
      blurb: o.blurb ?? p.blurb ?? p.repo?.description ?? "",
      source: p.repo?.html_url,
      language: p.repo?.language,
      updated: p.repo?.pushed_at,
      pinned: config.pinned.indexOf(p.domain),
      retired,
      up: retired ? false : await isUp(p.domain),
    };
  }),
);

const byRecency = (a, b) => (b.updated ?? "").localeCompare(a.updated ?? "");
const pinned = list.filter((p) => !p.retired && p.pinned >= 0).sort((a, b) => a.pinned - b.pinned);
const rest = list.filter((p) => !p.retired && p.pinned < 0).sort(byRecency);
const live = [...pinned, ...rest];
const retired = list.filter((p) => p.retired).sort((a, b) => a.name.localeCompare(b.name));

for (const p of live) if (!p.up) console.warn(`down: ${p.domain}`);

const card = (p) => `
      <li class="card${p.up ? "" : " down"}">
        <a class="title" href="https://${esc(p.domain)}/">${esc(p.name)}</a>
        <p>${esc(p.blurb)}</p>
        <span class="domain">${esc(p.domain)}</span>
        <div class="meta">${[
          p.up ? "" : `<span class="status">unreachable</span>`,
          p.updated ? `<span>updated <time datetime="${esc(p.updated)}" title="${esc(p.updated.slice(0, 10))}">${ago(p.updated)}</time></span>` : "",
          p.language ? `<span>${esc(p.language)}</span>` : "",
          p.source ? `<a href="${esc(p.source)}">source</a>` : "",
        ].filter(Boolean).join("")}</div>
      </li>`;

const template = await readFile(new URL("template.html", root), "utf8");
const html = template
  .replace("{{projects}}", live.map(card).join(""))
  .replace("{{retired}}", retired.map((p) => `<li><span>${esc(p.name)}</span> ${esc(p.blurb)}</li>`).join("\n        "))
  .replace("{{count}}", String(live.length))
  .replace("{{built}}", now.toISOString().slice(0, 10))
  .replace("{{builtIso}}", now.toISOString());

await mkdir(out, { recursive: true });
await writeFile(new URL("index.html", out), html);
await cp(new URL("assets/", root), new URL("assets/", out), { recursive: true });
await cp(new URL("CNAME", root), new URL("CNAME", out));
console.log(`built ${live.length} live, ${retired.length} retired`);
