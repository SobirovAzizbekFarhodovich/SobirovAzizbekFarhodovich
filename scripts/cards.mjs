// Builds the "GitHub activity" and "Most used languages" cards for the profile
// README, in a dark and a light variant, as plain SVG files.
//
// It runs in GitHub Actions with the built-in GITHUB_TOKEN and reads public
// data only, so the cards never depend on a third-party image service.
//
//   GITHUB_TOKEN=... node scripts/cards.mjs [outDir]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USER = process.env.GH_USER || 'SobirovAzizbekFarhodovich';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.argv[2] || 'dist';

const HIDDEN_LANGUAGES = new Set(['HTML']);
const LANGUAGE_SLOTS = 6; // top five plus "Other"

const THEMES = {
  dark: {
    panel: '#161b22',
    border: '#30363d',
    text: '#e6edf3',
    muted: '#8b949e',
    accent: '#00ADD8',
    rule: '#21262d',
    other: '#6e7681',
  },
  light: {
    panel: '#f6f8fa',
    border: '#d0d7de',
    text: '#1f2328',
    muted: '#59636e',
    accent: '#007D9C',
    rule: '#e4e8ec',
    other: '#8c959f',
  },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

const QUERY = `
query ($login: String!, $after: String) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 20) { edges { size node { name color } } }
      }
    }
  }
}`;

async function graphql(variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'profile-cards',
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GitHub API: ${JSON.stringify(body.errors)}`);
  if (!body.data.user) throw new Error(`User ${USER} not found`);
  return body.data.user;
}

async function fetchData() {
  let after = null;
  let calendar;
  let repoCount = 0;
  const repos = [];
  do {
    const user = await graphql({ login: USER, after });
    calendar ??= user.contributionsCollection.contributionCalendar;
    repoCount = user.repositories.totalCount;
    repos.push(...user.repositories.nodes);
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);
  return { calendar, repoCount, repos };
}

function streaks(calendar) {
  const days = calendar.weeks.flatMap((w) => w.contributionDays);
  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = day.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today may simply not have a contribution yet, so it does not break the streak.
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  let current = 0;
  while (i >= 0 && days[i].contributionCount > 0) {
    current++;
    i--;
  }
  return { current, longest };
}

function languages(repos) {
  const totals = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      if (HIDDEN_LANGUAGES.has(node.name)) continue;
      const entry = totals.get(node.name) ?? { name: node.name, color: node.color, size: 0 };
      entry.size += size;
      totals.set(node.name, entry);
    }
  }
  const sorted = [...totals.values()].sort((a, b) => b.size - a.size);
  const sum = sorted.reduce((n, l) => n + l.size, 0) || 1;
  const top = sorted.slice(0, sorted.length > LANGUAGE_SLOTS ? LANGUAGE_SLOTS - 1 : LANGUAGE_SLOTS);
  const rest = sorted.slice(top.length).reduce((n, l) => n + l.size, 0);
  const list = top.map((l) => ({ ...l, share: l.size / sum }));
  if (rest > 0) list.push({ name: 'Other', color: null, size: rest, share: rest / sum });
  return list;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => n.toLocaleString('en-US');
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
const pct = (share) => `${(share * 100).toFixed(1)}%`;

const W = 390;
const H = 200;
const PAD = 24;

function frame(t, title, label, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">
  <title id="t">${esc(label)}</title>
  <style>
    text { font-family: ${FONT}; }
    .title { font-size: 16px; font-weight: 600; fill: ${t.text}; }
    .label { font-size: 13px; fill: ${t.muted}; }
    .value { font-size: 13px; font-weight: 600; fill: ${t.text}; }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.panel}" stroke="${t.border}"/>
  <rect x="${PAD}" y="25" width="4" height="16" rx="2" fill="${t.accent}"/>
  <text class="title" x="${PAD + 12}" y="39">${esc(title)}</text>
${body}
</svg>
`;
}

function statsCard(t, data) {
  const { current, longest } = streaks(data.calendar);
  const stars = data.repos.reduce((n, r) => n + r.stargazerCount, 0);
  const rows = [
    ['Contributions in the last year', num(data.calendar.totalContributions)],
    ['Current streak', plural(current, 'day')],
    ['Longest streak', plural(longest, 'day')],
    ['Stars earned', num(stars)],
    ['Public repositories', num(data.repoCount)],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = 76 + i * 26;
      const rule = i < rows.length - 1 ? `\n  <rect x="${PAD}" y="${y + 9}" width="${W - 2 * PAD}" height="1" fill="${t.rule}"/>` : '';
      const fill = i === 0 ? ` style="fill:${t.accent}"` : '';
      return `  <text class="label" x="${PAD}" y="${y}">${esc(label)}</text>
  <text class="value" x="${W - PAD}" y="${y}" text-anchor="end"${fill}>${esc(value)}</text>${rule}`;
    })
    .join('\n');
  const label = rows.map(([l, v]) => `${l}: ${v}`).join(', ');
  return frame(t, 'GitHub activity', `GitHub activity. ${label}`, body);
}

function languagesCard(t, list) {
  const barW = W - 2 * PAD;
  let x = PAD;
  const segments = list
    .map((l, i) => {
      const w = i === list.length - 1 ? PAD + barW - x : Math.round(l.share * barW * 100) / 100;
      const seg = `<rect x="${x.toFixed(2)}" y="58" width="${Math.max(w, 0).toFixed(2)}" height="10" fill="${l.color ?? t.other}"/>`;
      x += w;
      return seg;
    })
    .join('');
  const colW = (W - 2 * PAD - 24) / 2;
  const legend = list
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = PAD + col * (colW + 24);
      const y = 106 + row * 30;
      return `  <circle cx="${lx + 5}" cy="${y - 4.5}" r="5" fill="${l.color ?? t.other}"/>
  <text class="value" x="${lx + 18}" y="${y}">${esc(l.name)}</text>
  <text class="label" x="${lx + colW}" y="${y}" text-anchor="end">${pct(l.share)}</text>`;
    })
    .join('\n');
  const body = `  <clipPath id="bar"><rect x="${PAD}" y="58" width="${barW}" height="10" rx="5"/></clipPath>
  <rect x="${PAD}" y="58" width="${barW}" height="10" rx="5" fill="${t.rule}"/>
  <g clip-path="url(#bar)">${segments}</g>
${legend}`;
  const label = list.map((l) => `${l.name} ${pct(l.share)}`).join(', ');
  return frame(t, 'Most used languages', `Most used languages by code size: ${label}`, body);
}

if (!TOKEN) {
  console.error('GITHUB_TOKEN is not set');
  process.exit(1);
}

const data = await fetchData();
const langs = languages(data.repos);
await mkdir(OUT, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(join(OUT, `stats-${name}.svg`), statsCard(theme, data));
  await writeFile(join(OUT, `languages-${name}.svg`), languagesCard(theme, langs));
}
console.log(
  `${USER}: ${data.calendar.totalContributions} contributions, ${data.repoCount} public repos, ` +
    `languages: ${langs.map((l) => `${l.name} ${pct(l.share)}`).join(', ')}`,
);
