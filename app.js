'use strict';

/**
 * Daylite Digital demo front end.
 * - All dynamic text is rendered with textContent (never innerHTML).
 * - The browser never sends a price: it sends only an experience id and a traveller count.
 * - Totals shown before checkout are a convenience preview; the server recalculates them.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { config: null, recommendations: [], selected: null, order: null, buttons: null, sdkPromise: null };

  /* ------------------------------ small helpers ------------------------------ */

  function el(tag, opts, children) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.className) node.className = opts.className;
      if (opts.text !== undefined) node.textContent = opts.text;
      if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
    }
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function announce(message) {
    $('live-region').textContent = message;
  }

  function showError(id, message) {
    const node = $(id);
    node.textContent = message;
    node.hidden = !message;
  }

  function money(cents, currency) {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }

  function toCents(decimalString) {
    return Math.round(Number(decimalString) * 100);
  }

  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) {
      const err = new Error('Could not reach the server. Please check your connection and try again.');
      err.code = 'NETWORK';
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || 'Something went wrong. Please try again.');
      err.code = (data && data.error && data.error.code) || 'ERROR';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* --------------------------------- steps ---------------------------------- */

  function go(step, focusHeading) {
    const panelFor = { 1: ['step-1'], 2: ['step-2'], 3: ['step-3'], 4: ['step-4'], 5: ['step-5'] };
    Object.values(panelFor).flat().forEach((id) => { $(id).hidden = true; });
    panelFor[step].forEach((id) => { $(id).hidden = false; });
    document.querySelectorAll('#stepper li').forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle('is-current', n === step);
      li.classList.toggle('is-done', n < step);
      if (n === step) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    const heading = $(`h-${step}`);
    if (focusHeading !== false && heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: false });
    }
    announce(heading ? heading.textContent : '');
  }

  function renderRecommendations(list, model) {
    const box = $('rec-list');
    clear(box);
    $('rec-empty').hidden = list.length > 0;
    $('rec-meta').textContent = list.length
      ? `Gemini (${model}) matched your request to ${list.length} demonstration ${list.length === 1 ? 'experience' : 'experiences'}. Names, descriptions and prices below come from the server catalogue; only the explanation is written by the AI.`
      : '';
    list.forEach((exp, i) => {
      const select = el('button', { className: 'btn btn-primary', text: 'Select', attrs: { type: 'button', 'aria-label': `Select ${exp.name}` } });
      select.addEventListener('click', () => chooseExperience(i));
      box.appendChild(
        el('article', { className: 'card' }, [
          el('h3', { text: exp.name }),
          el('p', { className: 'loc', text: `${exp.location} · ${exp.durationDays} ${exp.durationDays === 1 ? 'day' : 'days'}` }),
          el('p', { text: exp.description }),
          el('p', { className: 'why' }, [el('strong', { text: 'Why it matches: ' }), document.createTextNode(exp.reason)]),
          el('p', { className: 'price' }, [
            document.createTextNode(`${exp.pricePerTraveller} ${exp.currency} per traveller `),
            el('small', { text: '(demonstration price)' }),
          ]),
          select,
        ])
      );
    });
  }

  function chooseExperience(index) {
    state.selected = state.recommendations[index];
    const exp = state.selected;
    const box = $('selected-summary');
    clear(box);
    box.appendChild(el('h3', { text: exp.name }));
    box.appendChild(el('p', { text: `${exp.location} · ${exp.durationDays} ${exp.durationDays === 1 ? 'day' : 'days'}` }));
    box.appendChild(el('p', { text: exp.description }));
    $('travellers').value = '1';
    showError('select-error', '');
    updateTotal();
    go(3);
  }

  function readTravellers() {
    const raw = $('travellers').value.trim();
    if (!/^\d{1,2}$/.test(raw)) return null;
    const n = Number(raw);
    const { minTravellers = 1, maxTravellers = 10 } = state.config || {};
    return n >= minTravellers && n <= maxTravellers ? n : null;
  }

  function updateTotal() {
    const n = readTravellers();
    const exp = state.selected;
    $('total-amount').textContent = n && exp ? money(toCents(exp.pricePerTraveller) * n, exp.currency) : '—';
  }

  function summaryRow(dl, label, value, mono) {
    dl.appendChild(el('dt', { text: label }));
    dl.appendChild(el('dd', { text: value, className: mono ? 'mono' : '' }));
  }

  function renderOrderSummary() {
    const dl = $('order-summary');
    clear(dl);
    const exp = state.selected;
    summaryRow(dl, 'Experience', exp.name);
    summaryRow(dl, 'Location', exp.location);
    summaryRow(dl, 'Travellers', String(state.travellers));
    if (state.order) {
      summaryRow(dl, 'Amount (server-calculated)', `${state.order.amount} ${state.order.currency}`);
      summaryRow(dl, 'Booking reference', state.order.bookingReference, true);
    } else {
      summaryRow(dl, 'Amount (preview)', money(toCents(exp.pricePerTraveller) * state.travellers, exp.currency));
    }
  }

  /* ------------------------------- PayPal SDK -------------------------------- */

  function loadPayPalSdk(clientId, currency) {
    if (state.sdkPromise) return state.sdkPromise;
    state.sdkPromise = new Promise((resolve, reject) => {
      if (window.paypal && window.paypal.Buttons) return resolve(window.paypal);
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
      script.async = true;
      script.onload = () => (window.paypal && window.paypal.Buttons ? resolve(window.paypal) : reject(new Error('PayPal SDK did not initialise.')));
      script.onerror = () => reject(new Error('Could not load the PayPal SDK.'));
      document.head.appendChild(script);
    });
    state.sdkPromise.catch(() => { state.sdkPromise = null; });
    return state.sdkPromise;
  }

  async function startPayPal() {
    showError('select-error', '');
    const n = readTravellers();
    if (!n) {
      showError('select-error', 'Please enter a whole number of travellers from 1 to 10.');
      $('travellers').focus();
      return;
    }
    if (!state.config || !state.config.paypalConfigured || !state.config.paypalClientId) {
      showError('select-error', 'PayPal Sandbox is not configured on this server. See docs/SETUP.md.');
      return;
    }
    state.travellers = n;
    state.order = null;
    showError('paypal-error', '');
    $('paypal-status').textContent = 'Loading PayPal…';
    renderOrderSummary();
    go(4);

    let paypal;
    try {
      paypal = await loadPayPalSdk(state.config.paypalClientId, state.config.currency);
    } catch (err) {
      $('paypal-status').textContent = '';
      showError('paypal-error', err.message);
      return;
    }
    $('paypal-status').textContent = '';
    if (state.buttons && state.buttons.close) {
      try { await state.buttons.close(); } catch (_) { /* ignore */ }
    }
    clear($('paypal-buttons'));

    state.buttons = paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'pay' },
      // The server creates the order and sets the amount. Only an id and a count are sent.
      createOrder: async () => {
        showError('paypal-error', '');
        try {
          const order = await api('/api/checkout/create-order', { experienceId: state.selected.id, travellers: state.travellers });
          state.order = order;
          renderOrderSummary();
          return order.orderId;
        } catch (err) {
          showError('paypal-error', err.message);
          throw err;
        }
      },
      onApprove: async (data, actions) => {
        $('paypal-status').textContent = 'Capturing and verifying your Sandbox payment…';
        try {
          const confirmation = await api('/api/checkout/capture', { orderId: data.orderID });
          $('paypal-status').textContent = '';
          renderConfirmation(confirmation);
          go(5);
        } catch (err) {
          $('paypal-status').textContent = '';
          showError('paypal-error', err.message);
          if (err.code === 'PAYMENT_DECLINED' && actions && actions.restart) {
            try { return await actions.restart(); } catch (_) { /* fall through to manual retry */ }
          }
        }
      },
      onCancel: async (data) => {
        $('paypal-status').textContent = '';
        try {
          if (data && data.orderID) await api('/api/checkout/cancel', { orderId: data.orderID });
        } catch (_) { /* cancellation is best-effort on the server */ }
        showError('paypal-error', 'Payment cancelled. You have not been charged. You can choose a PayPal button to try again.');
      },
      onError: () => {
        showError('paypal-error', 'PayPal reported a problem. No confirmation was issued. Please try again.');
      },
    });
    if (state.buttons.isEligible && !state.buttons.isEligible()) {
      showError('paypal-error', 'PayPal buttons are not available in this browser.');
      return;
    }
    state.buttons.render('#paypal-buttons');
  }

  function renderConfirmation(c) {
    const dl = $('confirmation');
    clear(dl);
    summaryRow(dl, 'Booking reference', c.bookingReference, true);
    summaryRow(dl, 'Experience', c.experience.name);
    summaryRow(dl, 'Location', c.experience.location);
    summaryRow(dl, 'Travellers', String(c.travellers));
    summaryRow(dl, 'Amount', c.amount);
    summaryRow(dl, 'Currency', c.currency);
    summaryRow(dl, 'PayPal order ID', c.paypalOrderId, true);
    summaryRow(dl, 'PayPal capture ID', c.paypalCaptureId || 'Not available', true);
    summaryRow(dl, 'Confirmed at (UTC)', c.confirmedAt);
    $('confirmation-notice').textContent = c.notice;
  }

  /* --------------------------------- wiring ---------------------------------- */

  async function discover(event) {
    event.preventDefault();
    showError('discover-error', '');
    const query = $('query').value.trim();
    if (query.length < 3) {
      showError('discover-error', 'Please describe the experience you are looking for.');
      $('query').focus();
      return;
    }
    const btn = $('discover-btn');
    btn.disabled = true;
    btn.textContent = 'Asking Gemini…';
    announce('Asking Gemini for recommendations');
    try {
      const out = await api('/api/recommend', { query });
      state.recommendations = out.recommendations;
      renderRecommendations(out.recommendations, out.model);
      go(2);
    } catch (err) {
      showError('discover-error', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ask Gemini';
    }
  }

  function restart() {
    state.selected = null;
    state.order = null;
    state.recommendations = [];
    $('query').value = '';
    $('query-count').textContent = '0 / 500';
    clear($('confirmation'));
    go(1);
  }

  async function init() {
    $('discover-form').addEventListener('submit', discover);
    $('query').addEventListener('input', () => { $('query-count').textContent = `${$('query').value.length} / 500`; });
    document.querySelectorAll('#examples .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        $('query').value = chip.textContent;
        $('query-count').textContent = `${chip.textContent.length} / 500`;
        $('query').focus();
      });
    });
    $('travellers').addEventListener('input', updateTotal);
    $('to-paypal').addEventListener('click', startPayPal);
    $('back-to-1').addEventListener('click', () => go(1));
    $('back-to-2').addEventListener('click', () => go(2));
    $('back-to-3').addEventListener('click', () => go(3));
    $('restart').addEventListener('click', restart);

    try {
      state.config = await api('/api/config');
      const missing = [];
      if (!state.config.aiConfigured) missing.push('the Gemini AI assistant');
      if (!state.config.paypalConfigured) missing.push('PayPal Sandbox');
      if (missing.length) {
        const warn = $('config-warning');
        warn.textContent = `Server setup incomplete: ${missing.join(' and ')} not configured. See docs/SETUP.md.`;
        warn.hidden = false;
      }
    } catch (err) {
      const warn = $('config-warning');
      warn.textContent = err.message;
      warn.hidden = false;
    }
  }

  init();
})();
