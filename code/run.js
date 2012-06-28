// Your code here.

setup = function() {
  size(400, 200);
  background(255);
  stroke(random(255));
};

var i = 0;
draw = function() {
  line(i, 0, i, height);
  i += 4;
  if (i > width) {
    j = 0;
    stroke(random(255));
  }
};

