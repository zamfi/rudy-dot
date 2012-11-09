// Your code here.

setup = function() {
  size(200, 400);
  background(255);
  stroke(random(255));
  colorMode(HSB, 360, 100, 100);
};

var i = 0;
draw = function() {
  line(i, 0, i, height);
  i += 4;
  if (i > width) {
    i = 0;
    stroke(random(360), 100, 100);
  }
};
