require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');

const app = express();
app.use(cors());
app.use(express.json());

// Prevent indexing by search engines via HTTP header
app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

// Optional simple HTTP Basic Auth (enabled when BASIC_USER and BASIC_PASS set)
const BASIC_USER = process.env.BASIC_USER;
const BASIC_PASS = process.env.BASIC_PASS;
if (BASIC_USER && BASIC_PASS) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="NotionViewer"');
      return res.status(401).send('Unauthorized');
    }
    const creds = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
    const idx = creds.indexOf(':');
    const user = idx >= 0 ? creds.slice(0, idx) : creds;
    const pass = idx >= 0 ? creds.slice(idx + 1) : '';
    if (user === BASIC_USER && pass === BASIC_PASS) return next();
    res.set('WWW-Authenticate', 'Basic realm="NotionViewer"');
    return res.status(401).send('Unauthorized');
  });
}

app.use(express.static('public'));

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

function formatPlainTextFromTitle(prop) {
  if (!prop) return '';
  if (Array.isArray(prop.title)) return (prop.title[0] && prop.title[0].plain_text) || '';
  return '';
}

function formatPlainTextFromRichText(rt) {
  if (!rt) return '';
  if (Array.isArray(rt.rich_text)) return rt.rich_text.map(t => t.plain_text).join('\n');
  return '';
}

app.get('/api/records', async (req, res) => {
  try {
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 6); // 直近1週間（今日含む）
    const fromStr = from.toISOString().slice(0, 10);

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'changedDay',
        date: { on_or_after: fromStr }
      },
      sorts: [{ property: 'changedDay', direction: 'descending' }]
    });

    const items = response.results.map(page => {
      const props = page.properties || {};
      return {
        id: page.id,
        title: formatPlainTextFromTitle(props['Title']),
        detail: formatPlainTextFromRichText(props['Detail']),
        metanote: formatPlainTextFromRichText(props['MetaNote']),
        fav: (props['fav'] && props['fav'].number) || 0,
        changedDay: (props['changedDay'] && props['changedDay'].date && props['changedDay'].date.start) || null,
        // created time from page object
        createdTime: page.created_time || null,
        // relation ids (will be resolved to names below)
        __relations: {
          Team_List: (props['Team_List'] && props['Team_List'].relation) || [],
          Subject_List: (props['Subject_List'] && props['Subject_List'].relation) || [],
          Project_List: (props['Project_List'] && props['Project_List'].relation) || []
        }
        ,
        changedlog: (props['changedlog'] && props['changedlog'].multi_select) ? props['changedlog'].multi_select.map(s => s.name) : []
      };
    });

    // Resolve relation ids to names by fetching the referenced pages
    const relIds = new Set();
    items.forEach(it => {
      Object.values(it.__relations).forEach(arr => arr.forEach(r => relIds.add(r.id)));
    });

    const idToName = {};
    if (relIds.size > 0) {
      const pages = await Promise.all(Array.from(relIds).map(id =>
        notion.pages.retrieve({ page_id: id }).catch(() => null)
      ));
      pages.forEach(p => {
        if (!p) return;
        // try several property names to extract a title
        const name = formatPlainTextFromTitle((p.properties && (p.properties['Title'] || p.properties['title'])) || p.properties && Object.values(p.properties).find(x=>x.type==='title') || null) || (p.properties && Object.values(p.properties).map(v=> (v && v.rich_text && v.rich_text.map(t=>t.plain_text).join(''))).find(Boolean)) || p.id;
        idToName[p.id] = name;
      });
    }

    // Attach resolved names and cleanup
    const out = items.map(it => {
      const team = (it.__relations.Team_List || []).map(r => idToName[r.id] || r.id);
      const subject = (it.__relations.Subject_List || []).map(r => idToName[r.id] || r.id);
      const project = (it.__relations.Project_List || []).map(r => idToName[r.id] || r.id);
      return {
        id: it.id,
        title: it.title,
        detail: it.detail,
        metanote: it.metanote,
        fav: it.fav,
        changedDay: it.changedDay,
        createdTime: it.createdTime,
        changedlog: it.__relations && it.__relations.changedlog ? it.__relations.changedlog : it.changedlog || [],
        Team_List: team,
        Subject_List: subject,
        Project_List: project
      };
    });

    res.json({ items: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to query database' });
  }
});

app.post('/api/comment', async (req, res) => {
  try {
    const { pageId, comment } = req.body;
    if (!pageId || !comment) return res.status(400).json({ error: 'pageId and comment required' });

    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = page.properties || {};
    const existing = (props['MetaNote'] && props['MetaNote'].rich_text) || [];

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const suffix = `${yyyy}/${mm}/${dd}`;
    const newText = `${comment}:${suffix}`;

    // Combine existing plain_text pieces into a single string with explicit newlines
    const existingText = existing.map(t => t.plain_text).join('\n');
    const combined = existingText + (existingText ? '\n' : '') + newText;

    await notion.pages.update({
      page_id: pageId,
      properties: {
        MetaNote: {
          rich_text: [{ type: 'text', text: { content: combined } }]
        }
      }
    });

    res.json({ ok: true, metanote: combined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to add comment' });
  }
});

app.post('/api/like', async (req, res) => {
  try {
    const { pageId } = req.body;
    if (!pageId) return res.status(400).json({ error: 'pageId required' });

    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = page.properties || {};
    const current = (props['fav'] && props['fav'].number) || 0;
    const updated = current + 1;

    await notion.pages.update({
      page_id: pageId,
      properties: {
        fav: { number: updated }
      }
    });

    res.json({ ok: true, fav: updated });
  } catch (err) {
    console.error(err);
    const body = err && err.body ? err.body : null;
    res.status(500).json({ error: 'failed to update like', message: err.message || String(err), body });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
