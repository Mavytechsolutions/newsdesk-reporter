/* MAVY NEWS website: share / copy-link button on story pages. Nothing else runs. */
(function () {
  var b = document.getElementById('share-btn');
  if (!b) return;
  b.addEventListener('click', function () {
    var url = b.getAttribute('data-url'), title = b.getAttribute('data-title');
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { b.textContent = b.getAttribute('data-done'); });
  });
})();
