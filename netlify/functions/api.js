const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');

const app = express();
app.use(cors());
app.use(express.json());

// Basic Auth Middleware
const BASIC_USER = process.env.BASIC_USER;
const BASIC_PASS = process.env.BASIC_PASS;

if (BASIC_USER && BASIC_PASS) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const creds = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
    const [user, pass] = creds.split(':');
    if (user === BASIC_USER && pass === BASIC_PASS) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  });
}

// Notion client setup
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Property Mapping Config
const PROP_TITLE = process.env.NOTION_PROP_TITLE || 'Title';
const PROP_DETAIL = process.env.NOTION_PROP_DETAIL || 'Detail';
const PROP_COMMENT = process.env.NOTION_PROP_COMMENT || 'MetaNote';
const PROP_LIKE = process.env.NOTION_PROP_LIKE || 'fav';
const PROP_EXTRAS = process.env.NOTION_PROP_EXTRAS ? process.env.NOTION_PROP_EXTRAS.split(',').map(s => s.trim()) : [];
const SORT_PROP = process.env.NOTION_SORT_PROP || 'changedDay';
const SORT_DIR = process.env.NOTION_SORT_DIR || 'descending';

// Generic Formatter based on Notion Property Type
function formatProperty(prop) {
  if (!prop) return '';
  const type = prop.type;
  switch (type) {
    case 'title':
    case 'rich_text':
      return (prop[type] || []).map(t => t.plain_text).join('');
    case 'number':
      return prop.number !== null ? String(prop.number) : '0';
    case 'date':
      return prop.date ? (prop.date.end ? `${prop.date.start} ～ ${prop.date.end}` : prop.date.start) : '';
    case 'multi_select':
      return (prop.multi_select || []).map(s => s.name).join(', ');
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'status':
      return prop.status ? prop.status.name : '';
    case 'checkbox':
      return prop.checkbox ? '✅' : '☐';
    case 'relation':
      return (prop.relation || []).map(r => r.id);
    case 'people':
      return (prop.people || []).map(p => p.name || p.id || 'Unknown User').join(', ');
    case 'last_edited_time':
      return prop.last_edited_time;
    case 'created_time':
      return prop.created_time;
    case 'formula':
      const f = prop.formula;
      if (f.type === 'string') return f.string;
      if (f.type === 'number') return f.number !== null ? String(f.number) : '';
      if (f.type === 'date') return f.date ? f.date.start : '';
      if (f.type === 'boolean') return f.boolean ? '✅' : '☐';
      return '';
    case 'rollup':
      const r = prop.rollup;
      if (r.type === 'array') {
        // Simple heuristic: map internal types
        return r.array.map(item => formatProperty(item)).filter(v => v).join(', ');
      }
      if (r.type === 'number') return r.number !== null ? String(r.number) : '';
      if (r.type === 'date') return r.date ? r.date.start : '';
      return '';
    default:
      console.log(`[DEBUG] Unknown property type: ${type} for property`, prop);
      return '';
  }
}

const router = express.Router();

router.get('/records', async (req, res) => {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      sorts: [{ property: SORT_PROP, direction: SORT_DIR }]
    });

    const items = await Promise.all(response.results.map(async (page) => {
      const props = page.properties || {};
      
      const item = {
        id: page.id,
        title: formatProperty(props[PROP_TITLE]),
        detail: formatProperty(props[PROP_DETAIL]),
        comment: formatProperty(props[PROP_COMMENT]),
        like: (props[PROP_LIKE] && props[PROP_LIKE].number) || 0,
        url: page.url,
        createdTime: page.created_time,
        extras: [] // [{ label: 'PropName', value: 'Value' }]
      };

      // Handle Extra Properties
      const relIdsToResolve = new Set();
      const rawExtras = {};

      for (const propName of PROP_EXTRAS) {
        if (!props[propName]) {
          console.log(`[DEBUG] Property not found in Notion: "${propName}"`);
          rawExtras[propName] = `(Not Found: ${propName})`;
          continue;
        }
        const val = formatProperty(props[propName]);
        rawExtras[propName] = val;
        if (Array.isArray(val)) { // Relation IDs
          val.forEach(id => relIdsToResolve.add(id));
        }
      }

      return { ...item, __rawExtras: rawExtras, __relIds: Array.from(relIdsToResolve) };
    }));

    // Resolve ALL relations at once for performance
    const allRelIds = new Set();
    items.forEach(it => it.__relIds.forEach(id => allRelIds.add(id)));
    
    const idToTitle = {};
    if (allRelIds.size > 0) {
      const pages = await Promise.all(Array.from(allRelIds).map(id =>
        notion.pages.retrieve({ page_id: id }).catch(() => null)
      ));
      pages.forEach(p => {
        if (!p) return;
        const titleProp = Object.values(p.properties).find(v => v.type === 'title');
        idToTitle[p.id] = titleProp ? titleProp.title.map(t => t.plain_text).join('') : p.id;
      });
    }

    // Finalize items by replacing relation IDs with titles
    const finalized = items.map(it => {
      const extras = [];
      for (const [name, val] of Object.entries(it.__rawExtras)) {
        let displayVal = val;
        if (Array.isArray(val)) {
          displayVal = val.map(id => idToTitle[id] || id).join(', ');
        }
        extras.push({ label: name, value: displayVal });
      }
      return {
        id: it.id,
        title: it.title,
        detail: it.detail,
        comment: it.comment,
        like: it.like,
        url: it.url,
        createdTime: it.createdTime,
        extras: extras
      };
    });

    res.json({ items: finalized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to query database' });
  }
});

router.post('/comment', async (req, res) => {
  try {
    const { pageId, comment } = req.body;
    const page = await notion.pages.retrieve({ page_id: pageId });
    const existing = (page.properties[PROP_COMMENT] && page.properties[PROP_COMMENT].rich_text) || [];

    const now = new Date();
    const suffix = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
    const combined = existing.map(t => t.plain_text).join('\n') + (existing.length ? '\n' : '') + `${comment}:${suffix}`;

    await notion.pages.update({
      page_id: pageId,
      properties: {
        [PROP_COMMENT]: { rich_text: [{ type: 'text', text: { content: combined } }] }
      }
    });

    res.json({ ok: true, comment: combined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to add comment' });
  }
});

router.post('/like', async (req, res) => {
  try {
    const { pageId } = req.body;
    const page = await notion.pages.retrieve({ page_id: pageId });
    const current = (page.properties[PROP_LIKE] && page.properties[PROP_LIKE].number) || 0;
    const updated = current + 1;

    await notion.pages.update({
      page_id: pageId,
      properties: { [PROP_LIKE]: { number: updated } }
    });

    res.json({ ok: true, like: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to update like' });
  }
});

app.use('/.netlify/functions/api', router);
app.use('/api', router);
app.use('/', router);

module.exports.handler = serverless(app);
