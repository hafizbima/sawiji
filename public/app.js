document.addEventListener('DOMContentLoaded', function() {
  // Toast notification
  window.showToast = function(msg, type) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast ' + (type || '') + ' show';
    clearTimeout(t._hide); t._hide = setTimeout(() => t.classList.remove('show'), 2500);
  };

  // Active nav highlight
  const path = location.pathname;
  document.querySelectorAll('nav a').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });

  // Hold badge count
  const badge = document.getElementById('hold-badge');
  if (badge) {
    fetch('/api/hold-count').then(r => r.json()).then(d => {
      if (d.count > 0) { badge.textContent = d.count; badge.style.display = 'inline-flex'; }
    }).catch(() => {});
  }

  // Dynamic form
  const typeSelect = document.getElementById('type');
  if (typeSelect) {
    const fields = {
      'booking_new': ['schedule', 'session_count', 'nominal', 'payment_method', 'payment_status'],
      'payment': ['schedule', 'nominal', 'payment_method', 'payment_status', 'paid_by', 'ref_id'],
      'session_use': ['schedule', 'session_count'],
      'add_package': ['session_count', 'nominal', 'payment_method', 'payment_status'],
      'reschedule': ['from_schedule', 'to_schedule', 'reason'],
      'cancel': ['schedule', 'reason', 'ref_id'],
      'refund': ['nominal', 'payment_method', 'reason', 'ref_id'],
      'transfer': ['session_count', 'reason'],
    };
    function updateFields() {
      const type = typeSelect.value;
      const active = fields[type] || [];
      document.querySelectorAll('[class^="field-"]').forEach(el => {
        const m = el.className.match(/field-(\S+)/);
        if (m) {
          const show = active.includes(m[1]);
          el.style.display = show ? '' : 'none';
          if (show) { el.style.animation = 'none'; void el.offsetHeight; el.style.animation = 'fadeIn .25s ease'; }
          el.querySelector('input, select, textarea')?.removeAttribute('required');
        }
      });
    }
    typeSelect.addEventListener('change', updateFields);
    updateFields();
  }

  // Anti double-submit: disable tombol saat form dikirim
  document.querySelectorAll('form').forEach(f => {
    f.addEventListener('submit', function() {
      const b = this.querySelector('button[type="submit"], button:not([type])');
      if (b && !this.classList.contains('hold-confirm')) { b.disabled = true; setTimeout(() => b.disabled = false, 3000); }
    });
  });

  // Filter tabel klien-side (jadwal & riwayat): nol request server
  const search = document.getElementById('table-search');
  const table = search?.closest('main').querySelector('table');
  if (search && table) {
    const counter = document.getElementById('row-count');
    const rows = [...table.querySelectorAll('tr')].slice(1);
    search.addEventListener('input', function() {
      const q = this.value.toLowerCase();
      let shown = 0;
      rows.forEach(r => {
        const hit = r.textContent.toLowerCase().includes(q);
        r.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      if (counter) counter.textContent = q ? shown + ' / ' + rows.length : rows.length;
    });
  }

  // Quick filter: customer search on riwayat
  const customerInput = document.querySelector('input[name="customer"]');
  if (customerInput) {
    let timer;
    customerInput.addEventListener('input', function() {
      clearTimeout(timer);
      timer = setTimeout(() => this.closest('form')?.requestSubmit(), 400);
    });
  }

  // Confirm actions with AJAX on hold page
  document.querySelectorAll('.hold-confirm').forEach(form => {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const fd = new FormData(this);
      try {
        const r = await fetch(this.action, { method: 'POST', body: fd });
        if (r.ok) {
          showToast('Konfirmasi berhasil!', 'success');
          this.closest('tr')?.remove();
          const badge = document.getElementById('hold-badge');
          if (badge) {
            const c = (parseInt(badge.textContent) || 0) - 1;
            badge.textContent = c > 0 ? c : '';
            badge.style.display = c > 0 ? 'inline-flex' : 'none';
          }
        }
      } catch { showToast('Gagal konfirmasi', 'error'); }
    });
  });

  // Template copy feedback
  const copyBtn = document.querySelector('.btn-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      const text = document.getElementById('template-text')?.textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        this.textContent = 'Tersalin!';
        setTimeout(() => { this.textContent = 'Salin ke Clipboard'; }, 2000);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        this.textContent = 'Tersalin!';
        setTimeout(() => { this.textContent = 'Salin ke Clipboard'; }, 2000);
      });
    });
  }

  // Auto-dismiss alerts
  document.querySelectorAll('.flash').forEach(el => {
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
  });
});