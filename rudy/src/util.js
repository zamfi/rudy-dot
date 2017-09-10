function debounce(cb, delay) {
	let triggered = false;
	var latestArgs;
	let f = function() {
		latestArgs = Array.prototype.slice.call(arguments)
		if (! triggered) {
			triggered = setTimeout(() => {
        triggered = false;
				cb.apply(this, latestArgs)			
			}, delay)
		}
	}
  f.cancel = function() {
    if (triggered) {
      clearTimeout(triggered);
      return true;
    } else {
      return false;
    }
  }
  return f;
}

function queryString(obj) {
  let acc = [];
  for (let k in obj) {
    if (obj.hasOwnProperty(k)) {
      acc.push(`${k}=${encodeURIComponent(obj[k])}`);
    }
  }
  return acc.join('&');
}

export {debounce, queryString};