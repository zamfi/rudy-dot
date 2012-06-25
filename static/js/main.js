window.Main = Em.Application.create({
  controller: Em.Object.create({
    codeArea: null,
    play: function() {
      var randomId = Math.round(Math.random()*10000000000);
      $.ajax('/save', {
        type: 'post',
        data: {
          code: this.get('codeArea').getValue(),
          id: randomId
        },
        success: function(data, textStatus, xhr) {
          if (data.status == 'ok') {
            console.log("saved to", data.id);
          } else {
            console.log("error!");
          }
        }
      });
      window.open('/run/'+randomId);
    }
  })
});

$(function() {
  document.onkeypress = function(e) {
    if ((e.ctrlKey || e.metaKey) && e.keyCode == 114) { // Ctrl-R
      e.preventDefault();
      window.Main.controller.play();
    }
  }  
});
