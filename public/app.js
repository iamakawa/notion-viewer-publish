(function(){
  let items = [];
  let idx = 0;
  let authHeader = localStorage.getItem('authHeader') || null;

  const titleEl = document.getElementById('title');
  const detailEl = document.getElementById('detail');
  const commentEl = document.getElementById('comment');
  const metaInfoEl = document.getElementById('metaInfo');
  const likeCountEl = document.getElementById('likeCount');
  const commentInput = document.getElementById('commentInput');
  const sendComment = document.getElementById('sendComment');
  const likeBtn = document.getElementById('likeBtn');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const card = document.getElementById('card');

  // UI elements
  const loginOverlay = document.getElementById('loginOverlay');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loginUser = document.getElementById('loginUser');
  const loginPass = document.getElementById('loginPass');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  function render() {
    if (!items.length) {
      titleEl.textContent = 'データがありません';
      detailEl.textContent = '';
      metanoteEl.textContent = '';
      metaInfoEl.textContent = '';
      favCountEl.textContent = '0';
      return;
    }
    const it = items[idx];
    titleEl.textContent = it.title || '(無題)';
    detailEl.textContent = it.detail || '';
    commentEl.textContent = it.comment || '';
    
    const parts = [];
    const created = it.createdTime ? new Date(it.createdTime).toLocaleString() : '';
    if (created) parts.push('Created: ' + created);

    // Render Dynamic Extras
    if (it.extras && it.extras.length) {
      it.extras.forEach(ex => {
        if (ex.value) parts.push(`${ex.label}: ${ex.value}`);
      });
    }

    metaInfoEl.innerHTML = '';
    const textInfo = parts.join(' | ');
    if (textInfo) {
      const span = document.createElement('span');
      span.textContent = textInfo + ' | ';
      metaInfoEl.appendChild(span);
    }
    
    if (it.url) {
      const a = document.createElement('a');
      a.href = it.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'View Original';
      a.style.color = '#007bff';
      a.style.textDecoration = 'none';
      metaInfoEl.appendChild(a);
    }

    likeCountEl.textContent = String(it.like || 0);
  }

  function fetchWithAuth(url, options = {}) {
    if (!authHeader) return Promise.reject('No auth');
    showLoading();
    options.headers = options.headers || {};
    options.headers['Authorization'] = authHeader;
    return fetch(url, options)
      .then(r => {
        hideLoading();
        if (r.status === 401) {
          showLogin();
          throw new Error('Unauthorized');
        }
        return r.json();
      })
      .catch(err => {
        hideLoading();
        throw err;
      });
  }

  function load() {
    if (!authHeader) {
      showLogin();
      return;
    }
    fetchWithAuth('/api/records')
      .then(j => {
        items = j.items || [];
        idx = 0;
        hideLogin();
        render();
      })
      .catch(err => {
        if (err !== 'Unauthorized' && err.message !== 'Unauthorized') console.error(err);
      });
  }

  function showLogin() {
    loginOverlay.style.display = 'flex';
    loginError.style.display = 'none';
  }

  function hideLogin() {
    loginOverlay.style.display = 'none';
  }

  function showLoading() {
    loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    loadingOverlay.style.display = 'none';
  }

  loginBtn.addEventListener('click', () => {
    const user = loginUser.value.trim();
    const pass = loginPass.value.trim();
    if (!user || !pass) return;
    authHeader = 'Basic ' + btoa(user + ':' + pass);
    localStorage.setItem('authHeader', authHeader);
    load();
  });

  [loginUser, loginPass].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click();
  }));

  prevBtn.addEventListener('click', ()=>{ if(!items.length) return; idx = (idx -1 + items.length) % items.length; render(); });
  nextBtn.addEventListener('click', ()=>{ if(!items.length) return; idx = (idx +1) % items.length; render(); });

  document.addEventListener('keydown', (e)=>{
    if (loginOverlay.style.display !== 'none' || loadingOverlay.style.display !== 'none') return;
    if (e.key === 'ArrowLeft') prevBtn.click();
    if (e.key === 'ArrowRight') nextBtn.click();
  });

  sendComment.addEventListener('click', ()=>{
    if (!items.length) return; const text = commentInput.value.trim(); if(!text) return; const pageId = items[idx].id;
    fetchWithAuth('/api/comment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId,comment:text})})
      .then(j=>{ if(j.ok){ items[idx].comment = j.comment; commentInput.value=''; render(); } else alert('コメント失敗'); })
  });

  commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendComment.click();
    }
  });

  likeBtn.addEventListener('click', ()=>{
    if (!items.length) return; const pageId = items[idx].id;
    fetchWithAuth('/api/like',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId})})
      .then(j=>{ if(j.ok){ items[idx].like = j.like; render(); } else alert('いいね失敗'); })
  });

  load();
})();
