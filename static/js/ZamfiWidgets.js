window.ZamfiWidgets = Em.Namespace.create();

window.ZamfiWidgets.Slider = Em.View.extend({
  
  defaultTemplate: '<div class="slider" {{bindAttr style=view.sliderStyle}}><div class="bk"></div><div class="handle" {{bindAttr style=view.handleStyle}}></div>'
})