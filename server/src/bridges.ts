// Preview bridge injection, ported 1:1 from open-design
// apps/daemon/src/project-routes.ts (URL_PREVIEW_SNAPSHOT_BRIDGE + helpers).
// Only the snapshot bridge is ported; scroll/selection bridges belong to the
// comments subsystem, which is out of scope.

const URL_PREVIEW_SNAPSHOT_BRIDGE = `<script data-od-url-snapshot-bridge>
(function(){
  if (window.__odUrlSnapshotBridge) return;
  window.__odUrlSnapshotBridge = true;
  var SNAPSHOT_STYLE_PROPS = [
    'display','position','box-sizing','width','height','min-width','max-width','min-height','max-height',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'border','border-top','border-right','border-bottom','border-left','border-radius',
    'font','font-family','font-size','font-weight','font-style','line-height','letter-spacing',
    'color','background-color','opacity','transform','transform-origin','overflow','overflow-x','overflow-y',
    'white-space','text-align','vertical-align','object-fit','object-position',
    'flex','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
    'grid','grid-template-columns','grid-template-rows','grid-column','grid-row',
    'gap','row-gap','column-gap','align-items','align-content','align-self',
    'justify-items','justify-content','justify-self','inset','top','right','bottom','left',
    'z-index','box-shadow','text-shadow'
  ];
  function copyComputedStyle(source, target){
    if (!source || !target || source.nodeType !== 1 || target.nodeType !== 1) return;
    var computed = window.getComputedStyle(source);
    var style = target.getAttribute('style') || '';
    for (var i = 0; i < SNAPSHOT_STYLE_PROPS.length; i++){
      var prop = SNAPSHOT_STYLE_PROPS[i];
      var value = computed.getPropertyValue(prop);
      if (value) style += prop + ':' + value + ';';
    }
    target.setAttribute('style', style);
  }
  function syncElementState(source, target){
    var tag = source.tagName ? source.tagName.toLowerCase() : '';
    if (tag === 'img' && source.currentSrc) target.setAttribute('src', source.currentSrc);
    if (tag === 'input' || tag === 'textarea') target.setAttribute('value', source.value || '');
    if (tag === 'canvas') {
      try {
        var img = document.createElement('img');
        img.setAttribute('src', source.toDataURL('image/png'));
        img.setAttribute('style', target.getAttribute('style') || '');
        target.parentNode && target.parentNode.replaceChild(img, target);
      } catch (_) {}
    }
  }
  function inlineSnapshotStyles(originalRoot, cloneRoot){
    copyComputedStyle(originalRoot, cloneRoot);
    syncElementState(originalRoot, cloneRoot);
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length, 3500);
    for (var i = 0; i < count; i++){
      copyComputedStyle(originals[i], clones[i]);
      syncElementState(originals[i], clones[i]);
    }
    var scripts = cloneRoot.querySelectorAll('script');
    for (var s = scripts.length - 1; s >= 0; s--) scripts[s].remove();
    var links = cloneRoot.querySelectorAll('link[rel~="stylesheet"], link[rel~="preload"], link[rel~="preconnect"]');
    for (var l = links.length - 1; l >= 0; l--) links[l].remove();
    var styles = cloneRoot.querySelectorAll('style');
    for (var st = 0; st < styles.length; st++) {
      styles[st].textContent = (styles[st].textContent || '')
        .replace(/@import[^;]+;/gi, '')
        .replace(/@font-face\\s*\\{[^}]*\\}/gi, '');
    }
  }
  function pruneHiddenSnapshotNodes(originalRoot, cloneRoot){
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length);
    var removals = [];
    for (var i = 0; i < count; i++){
      var original = originals[i];
      var clone = clones[i];
      if (!original || !clone || !clone.parentNode) continue;
      var computed = window.getComputedStyle(original);
      if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) removals.push(clone);
    }
    for (var r = removals.length - 1; r >= 0; r--) {
      if (removals[r].parentNode) removals[r].parentNode.removeChild(removals[r]);
    }
  }
  function waitForImages(){
    var imgs = Array.prototype.slice.call(document.images || []);
    return Promise.all(imgs.map(function(img){
      if (img.complete) return Promise.resolve();
      return new Promise(function(resolve){
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }
  function scrollOffset(){
    var doc = document.documentElement;
    var body = document.body;
    return {
      x: Math.max(window.scrollX || 0, doc ? doc.scrollLeft || 0 : 0, body ? body.scrollLeft || 0 : 0),
      y: Math.max(window.scrollY || 0, doc ? doc.scrollTop || 0 : 0, body ? body.scrollTop || 0 : 0)
    };
  }
  function escapeAttribute(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function snapshotBackgroundColor(){
    try {
      var probe = window.getComputedStyle(document.body || document.documentElement);
      var bg = probe && probe.backgroundColor || '';
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return '#ffffff';
      return bg;
    } catch (_) { return '#ffffff'; }
  }
  function canvasLooksBlank(ctx, cw, ch){
    try {
      var data = ctx.getImageData(0, 0, cw, ch).data;
      var step = Math.max(4, Math.floor((cw * ch) / 4096)) * 4;
      var first = null, samples = 0;
      for (var i = 0; i + 3 < data.length; i += step){
        samples++;
        if (!first){ first = [data[i], data[i+1], data[i+2], data[i+3]]; continue; }
        if (Math.abs(data[i]-first[0]) > 6 || Math.abs(data[i+1]-first[1]) > 6 ||
            Math.abs(data[i+2]-first[2]) > 6 || Math.abs(data[i+3]-first[3]) > 6) return false;
      }
      return samples > 8;
    } catch (_) { return false; }
  }
  function renderSnapshot(id){
    var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    var h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var dpr = window.devicePixelRatio || 1;
    var bgColor = snapshotBackgroundColor();
    var docW = Math.max(w, document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
    var docH = Math.max(h, document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
    var clone = document.documentElement.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    inlineSnapshotStyles(document.documentElement, clone);
    pruneHiddenSnapshotNodes(document.documentElement, clone);
    var scroll = scrollOffset();
    var cloneBody = clone.querySelector('body');
    var rootStyle = clone.getAttribute('style') || '';
    var bodyStyle = cloneBody ? cloneBody.getAttribute('style') || '' : '';
    var bodyContent = cloneBody ? cloneBody.innerHTML : clone.innerHTML;
    var wrapperStyle = rootStyle + bodyStyle +
      'margin:0;position:relative;left:' + (-scroll.x) + 'px;top:' + (-scroll.y) + 'px;' +
      'width:' + docW + 'px;height:' + docH + 'px;overflow:visible;';
    var html = '<div xmlns="http://www.w3.org/1999/xhtml" style="' + escapeAttribute(wrapperStyle) + '">' + bodyContent + '</div>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<foreignObject x="0" y="0" width="' + docW + '" height="' + docH + '">' + html + '</foreignObject></svg>';
    var img = new Image();
    img.onload = function(){
      try {
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        var ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        if (canvasLooksBlank(ctx, canvas.width, canvas.height)) {
          window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: 'empty-render' }, '*');
          return;
        }
        window.parent.postMessage({ type: 'od:snapshot:result', id: id, dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }, '*');
      } catch (err) {
        window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: String(err && err.message || err) }, '*');
      }
    };
    img.onerror = function(){
      window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: 'snapshot image failed' }, '*');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:snapshot' || !data.id) return;
    waitForImages().then(function(){ renderSnapshot(String(data.id)); });
  });
})();
</script>`;

function previewBridgeTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(previewBridgeTokens);
  if (typeof value !== 'string') return [];
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

export function wantsSnapshotBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some(
    (token) => token === 'snapshot' || token === 'image' || token === 'capture',
  );
}

function injectBeforeBodyClose(html: string, marker: string, injection: string): string {
  if (html.includes(marker)) return html;
  const bodyCloseIndex = html.search(/<\/body\s*>/i);
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${injection}${html.slice(bodyCloseIndex)}`;
  }
  return `${html}${injection}`;
}

export function injectSnapshotBridge(html: string): string {
  return injectBeforeBodyClose(html, 'data-od-url-snapshot-bridge', URL_PREVIEW_SNAPSHOT_BRIDGE);
}

// 文案编辑 bridge（本项目自研，协议见
// docs/superpowers/specs/2026-06-11-visual-text-edit-design.md）：
// 宿主 postMessage pi:edit:activate/deactivate 控制；点选含直接文本的元素
// 进入 plaintext-only 就地编辑；提交时上报各文本节点的
// {oldText,newText,occurrence}，occurrence 为文档顺序中同值文本节点的序号；
// 宿主回 pi:edit:result {id,ok}，失败则还原 DOM。
const URL_PREVIEW_TEXT_EDIT_BRIDGE = `<script data-pi-text-edit-bridge>
(function(){
  if (window.__piTextEditBridge) return;
  window.__piTextEditBridge = true;
  var active = false;
  var hoverEl = null;
  var session = null;
  var pending = {};
  var seq = 0;
  // ── Babel 浏览器内插桩（spec 附录 B）────────────────────────────────
  // 本脚本注入在 </body> 前、同步执行，早于 @babel/standalone 的
  // DOMContentLoaded 编译钩子：先注册 pi-loc 插件给每个小写 JSX 宿主元素
  // 打 data-pi-loc="<fileIdx>:<line>:<column>"，再给 text/babel|text/jsx
  // 脚本补 data-plugins。注意 data-plugins 会整体覆盖 standalone 的默认
  // 插件，必须带上默认三件套。无 window.Babel 的纯 HTML 页面静默跳过。
  var locFiles = [];
  (function(){
    try {
      var B = window.Babel;
      if (!B || !B.registerPlugin || (B.availablePlugins && B.availablePlugins['pi-loc'])) return;
      B.registerPlugin('pi-loc', function(babel){
        var t = babel.types;
        return { visitor: { JSXOpeningElement: function(path, state){
          var node = path.node;
          if (!node.loc || !node.name || node.name.type !== 'JSXIdentifier') return;
          var first = node.name.name.charAt(0);
          if (first < 'a' || first > 'z') return;
          for (var i = 0; i < node.attributes.length; i++){
            var attr = node.attributes[i];
            if (attr.type === 'JSXAttribute' && attr.name && attr.name.name === 'data-pi-loc') return;
          }
          var fname = (state.file && state.file.opts && state.file.opts.filename) || '';
          if (!fname) return;
          var idx = locFiles.indexOf(fname);
          if (idx === -1){ locFiles.push(fname); idx = locFiles.length - 1; }
          node.attributes.push(t.jsxAttribute(
            t.jsxIdentifier('data-pi-loc'),
            t.stringLiteral(idx + ':' + node.loc.start.line + ':' + node.loc.start.column)
          ));
        } } };
      });
      var DEFAULT_PLUGINS = 'transform-class-properties,transform-object-rest-spread,transform-flow-strip-types';
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++){
        var s = scripts[i];
        var type = (s.type || '').split(';')[0].trim();
        if (type !== 'text/babel' && type !== 'text/jsx') continue;
        var dp = s.getAttribute('data-plugins');
        s.setAttribute('data-plugins', dp ? dp + ',pi-loc' : DEFAULT_PLUGINS + ',pi-loc');
      }
    } catch (_) {}
  })();
  function isSkippable(el){
    var tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    return tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'textarea';
  }
  function hasText(value){ return /\\S/.test(value || ''); }
  function hasDirectText(el){
    for (var n = el.firstChild; n; n = n.nextSibling){
      if (n.nodeType === 3 && hasText(n.nodeValue)) return true;
    }
    return false;
  }
  function editableFrom(target){
    var el = target && target.nodeType === 3 ? target.parentElement : target;
    while (el && el.nodeType === 1){
      if (isSkippable(el)) return null;
      if (hasDirectText(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function walkTextNodes(fn){
    var walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())){
      var p = n.parentElement;
      if (!p || isSkippable(p)) continue;
      if (!hasText(n.nodeValue)) continue;
      fn(n);
    }
  }
  // 最近 data-pi-loc 祖先的插桩位置；occurrence = 该祖先子树内同值文本
  // 节点中本节点的序号（与宿主 applyTextEditAtLoc 的对位口径一致）。
  function locInfoFor(node){
    var el = node.parentElement;
    while (el && el.nodeType === 1){
      var raw = el.getAttribute && el.getAttribute('data-pi-loc');
      if (raw){
        var parts = raw.split(':');
        var source = locFiles[parseInt(parts[0], 10)];
        var line = parseInt(parts[1], 10);
        var column = parseInt(parts[2], 10);
        if (typeof source !== 'string' || !source || !(line >= 1) || !(column >= 0)) return null;
        var occ = 0;
        var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        var n;
        while ((n = tw.nextNode())){
          if (n === node) break;
          var p = n.parentElement;
          if (p && !isSkippable(p) && n.nodeValue === node.nodeValue) occ++;
        }
        return { source: source, line: line, column: column, occurrence: occ };
      }
      el = el.parentElement;
    }
    return null;
  }
  function snapshotRecords(el){
    var targets = [];
    var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var t;
    while ((t = tw.nextNode())){
      var p = t.parentElement;
      if (!p || isSkippable(p)) continue;
      if (!hasText(t.nodeValue)) continue;
      targets.push(t);
    }
    var records = [];
    var counts = Object.create(null);
    walkTextNodes(function(n){
      var key = n.nodeValue;
      var idx = counts[key] || 0;
      counts[key] = idx + 1;
      if (targets.indexOf(n) !== -1){
        records.push({ node: n, value: n.nodeValue, occurrence: idx, loc: locInfoFor(n) });
      }
    });
    return records;
  }
  function ensureStyle(){
    if (document.querySelector('style[data-pi-text-edit-style]')) return;
    var st = document.createElement('style');
    st.setAttribute('data-pi-text-edit-style', '');
    st.textContent = '[data-pi-edit-hover]{outline:2px dashed #3b82f6 !important;outline-offset:2px;cursor:text}' +
      '[data-pi-edit-active]{outline:2px solid #2563eb !important;outline-offset:2px}';
    (document.head || document.documentElement).appendChild(st);
  }
  function clearHover(){
    if (hoverEl){ hoverEl.removeAttribute('data-pi-edit-hover'); hoverEl = null; }
  }
  function restoreRecords(records){
    for (var i = 0; i < records.length; i++){
      try { records[i].node.nodeValue = records[i].value; } catch (_) {}
    }
  }
  function finishEdit(commit){
    if (!session) return;
    var s = session;
    session = null;
    s.el.removeEventListener('keydown', onKeydown);
    s.el.removeEventListener('blur', onBlur);
    if (s.prevEditable === null) s.el.removeAttribute('contenteditable');
    else s.el.setAttribute('contenteditable', s.prevEditable);
    if (s.prevSpellcheck === null) s.el.removeAttribute('spellcheck');
    else s.el.setAttribute('spellcheck', s.prevSpellcheck);
    s.el.removeAttribute('data-pi-edit-active');
    if (!commit){
      restoreRecords(s.records);
      return;
    }
    var edits = [];
    for (var i = 0; i < s.records.length; i++){
      var r = s.records[i];
      var current = r.node.parentNode ? r.node.nodeValue : '';
      if (current !== r.value){
        var item = { oldText: r.value, newText: current, occurrence: r.occurrence };
        if (r.loc) item.loc = r.loc;
        edits.push(item);
      }
    }
    if (!edits.length) return;
    var id = 'pi-edit-' + (++seq);
    pending[id] = s.records;
    window.parent.postMessage({ type: 'pi:edit:commit', id: id, edits: edits }, '*');
  }
  function onKeydown(ev){
    if (!session) return;
    if (ev.key === 'Enter' && !ev.shiftKey){
      ev.preventDefault();
      var el = session.el;
      finishEdit(true);
      try { el.blur(); } catch (_) {}
    } else if (ev.key === 'Escape'){
      ev.preventDefault();
      var el2 = session.el;
      finishEdit(false);
      try { el2.blur(); } catch (_) {}
    }
  }
  function onBlur(){ finishEdit(true); }
  function beginEdit(el, ev){
    var records = snapshotRecords(el);
    if (!records.length) return;
    clearHover();
    session = {
      el: el,
      records: records,
      prevEditable: el.getAttribute('contenteditable'),
      prevSpellcheck: el.getAttribute('spellcheck')
    };
    el.setAttribute('data-pi-edit-active', '');
    try { el.setAttribute('contenteditable', 'plaintext-only'); } catch (_) {}
    if (!el.isContentEditable) el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('blur', onBlur);
    el.focus();
    try {
      var range = null;
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      else if (document.caretPositionFromPoint){
        var pos = document.caretPositionFromPoint(ev.clientX, ev.clientY);
        if (pos){
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (range){
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) {}
  }
  function onOver(ev){
    var el = editableFrom(ev.target);
    if (hoverEl === el) return;
    clearHover();
    if (el && (!session || session.el !== el)){
      el.setAttribute('data-pi-edit-hover', '');
      hoverEl = el;
    }
  }
  function onOut(){ clearHover(); }
  function onClick(ev){
    if (session && session.el.contains(ev.target)) return;
    var el = editableFrom(ev.target);
    if (!el){
      if (session) finishEdit(true);
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (session) finishEdit(true);
    beginEdit(el, ev);
  }
  function activate(){
    if (active) return;
    active = true;
    ensureStyle();
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('click', onClick, true);
    window.parent.postMessage({ type: 'pi:edit:state', active: true }, '*');
  }
  function deactivate(){
    if (!active) return;
    active = false;
    finishEdit(true);
    clearHover();
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('click', onClick, true);
    window.parent.postMessage({ type: 'pi:edit:state', active: false }, '*');
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'pi:edit:activate') activate();
    else if (data.type === 'pi:edit:deactivate') deactivate();
    else if (data.type === 'pi:edit:result' && data.id){
      var records = pending[data.id];
      delete pending[data.id];
      if (records && data.ok !== true) restoreRecords(records);
    }
  });
  window.parent.postMessage({ type: 'pi:edit:ready' }, '*');
})();
</script>`;

export function wantsTextEditBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some(
    (token) => token === 'edit' || token === 'text-edit' || token === 'text',
  );
}

export function injectTextEditBridge(html: string): string {
  return injectBeforeBodyClose(html, 'data-pi-text-edit-bridge', URL_PREVIEW_TEXT_EDIT_BRIDGE);
}
