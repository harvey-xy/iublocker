(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var target = params.get('url') || '';
  var label = document.getElementById('url');
  var button = document.getElementById('load');
  if (label !== null) label.textContent = target === '' ? 'Unknown source' : target;
  if (button === null) return;
  if (target === '' || /^(https?|ftp):/i.test(target) === false) {
    button.disabled = true;
    return;
  }
  button.addEventListener('click', function () {
    location.replace(target);
  });
})();
