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

function extra(elt) {
  if (! elt.__extra) {
    elt.__extra = {};
  }
  return elt.__extra;
}

function flattenNode(node, depth=0) {
  if (depth > 3) {
    try {
      return ""+node;
    } catch (e) {
      return "?";
    }
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  if (node instanceof Array) {
    return node.map(elt => flattenNode(elt, depth+1));
  }
  let obj = {};
  Object.keys(node).forEach(k => {
    let val = node[k];
    if (typeof val === 'object') {
      val = flattenNode(val, depth+1);
    }
    obj[k] = val;
  });
  return obj;
}

function flattenStack(stack) {
  return stack.map(frame => {
    let obj = {};
    Object.keys(frame).filter(k => frame.hasOwnProperty(k)).forEach(k => obj[k] = flattenNode(frame[k]));
    return obj;
  });
}

export {debounce, queryString, extra, flattenNode, flattenStack};