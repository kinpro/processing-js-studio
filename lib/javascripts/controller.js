// Global CouchDB connection
// TODO: refactor back within Sammy context
var couchapp = null;
$.CouchApp(function(app) {
  couchapp = app;
});

;(function($) {
  
  var flash = null;
  
  var app = new Sammy.Application(function() {
    with(this) {
     
      var app_ctx = this;
      element_selector = '#main';
      
      var displayFlash = function() { 
        if (null == flash) { 
          $('#flash').removeClass().html('').hide();
          return; 
        }
        $('#flash').addClass(flash.css_class).html(flash.message).fadeIn('fast');
        flash = null;
      };
      
      // TODO: refactor to toggleProgress()
      var displayProgress = function() {
        $('#progress').show();
        $('.button').addClass('progress');
      };
      var clearProgress = function() {
        $('#progress').fadeOut('fast');
        $('.button').removeClass('progress');
      };
      
      var menuSetup = function(selected_class, breadcrumbs) {
        
        selected_class = selected_class || '';
        breadcrumbs = breadcrumbs || [];
        
        $('#header > ul li').remove();
        for ( var i = 0; i < breadcrumbs.length; i++ ) {
          $('#header > ul').append('<li>' + breadcrumbs[i] + '</li>');
        }
        
        couchapp.design.view("sketches", {
          include_docs: true,
          success: function(json) {
            //console.log(json);  
            $('#nav ul.sketches li').remove();
            $('#nav ul.manage li:not(.add)').remove();  
            for ( var i = 0; i < json.rows.length; i++ ) {
              $('#nav ul.sketches').append(
                "<li class='" + ('sketch/' + json.rows[i].doc._id).cssify() + 
                "'><a href='#/sketch/" + json.rows[i].doc._id + "'>" +
                 json.rows[i].doc.name +
                "</a></li>"
              );
              $('#nav ul.manage').append(
                "<li class='" + ('manage/edit/' + json.rows[i].doc._id).cssify() + 
                "'><a href='#/manage/edit/" + json.rows[i].doc._id + "'>" +
                 json.rows[i].doc.name +
                "</a></li>"
              );
            };
            
            $('#nav li').each(function() {
              $(this).removeClass('selected');
              if ($(this).hasClass(selected_class)) {
                $(this).addClass('selected');
              }
            });
          }
        });
      };
      
      bind('event-context-before', function(e, data) {
        clearProgress();
        displayFlash();
      });
      
      get('#/', function() { 
        this.redirect('#/renderings/by/date');
      });
      
      get('#/renderings/by/date', function() {
        displayProgress();
        menuSetup('renderings-by-date', ['Renderings', 'by date']);
        var ctx = this;
        couchapp.design.view("renderings-by-date", {
          include_docs: true,
          success: function(json) {
            //console.log(json);  
            ctx.partial('views/renderings/index.html', {list: json.rows.reverse()});
            clearProgress();
          }
        });
      });
      
      get('#/renderings/by/sketch', function() {
        displayProgress();
        menuSetup('renderings-by-sketch', ['Renderings', 'by sketch']);
        var ctx = this;
        couchapp.design.view("renderings-by-sketch", {
          include_docs: true,
          success: function(json) {
            //console.log(json);  
            ctx.partial('views/renderings/index.html', {list: json.rows});
            clearProgress();
          }
        });
      });
      
      get('#/rendering/:id', function() {
        displayProgress();
        var ctx = this;
        couchapp.db.openDoc(ctx.params["id"], {
          success: function(json) {
            menuSetup('', ['Renderings', json.sketch.name, couchapp.prettyDate(json.created_at)]);
            $.get('views/renderings/show.html', function(template) {
              app_ctx.swap($.srender(json._id, template, {
                item: json, 
                timestamp: couchapp.prettyDate(json.created_at),
              }));
              sh_highlightDocument();
              clearProgress();
            });
          }
        });
      });

      get('#/sketch/:id', function() {
        displayProgress();
        var ctx = this;
        couchapp.db.openDoc(ctx.params["id"], {
          success: function(json) {
            //console.log(json);
            menuSetup(('sketch/' + json._id).cssify(), ['Generate', json.name]);
            $.get('views/sketches/show.html', function(template) {
              var to = json._attachments ? 500 : 0; // Need some extra time to load the images
              app_ctx.swap($.srender(json._id, template, {item: json}));
              window.setTimeout(function() {
                $('canvas#view').each(function() {
                  Processing(this, json.code);
                });
                clearProgress();
              }, to);
            });
          }
        });     
      });
      
      get('#/sketch/reload/:id', function() {
        this.redirect('#/sketch/' + this.params['id']);
      });
      
      get('#/renderings/save/:sketch_id', function() { 
        displayProgress();
        var ctx = this;
        var tid = ctx.params['sketch_id'];
        couchapp.db.openDoc(tid, {
          success: function(json) {
            //console.log(json);
            var thumbnail_canvas = scaleCanvas($('canvas#view')[0],150,120);
            var palette_canvas = scaleCanvas($('canvas#view')[0],15,12);
            couchapp.db.saveDoc(
              {
                type: 'rendering',
                created_at: new Date().toJSON(),
                sketch: {
                  name: json.name,
                  code: json.code,
                  id: json._id,
                  revision: json._rev
                },
                "_attachments": {
                  "rendering.png": {
                    "content_type": "image\/png", "data": encodeCanvas($('canvas#view')[0])
                  },
                  "thumbnail.png": {
                    "content_type": "image\/png", "data": encodeCanvas(thumbnail_canvas)
                  },
                  "palette.png": {
                    "content_type": "image\/png", "data": encodeCanvas(palette_canvas)
                  }
                },
                palette: hexPaletteFromCanvas(palette_canvas)
              }, {
              success: function(jsonb) {
                //console.log('stored doc: ', json)
                flash = { 
                  message: "Stored a rendering of '" + json.name + 
                    "' - <a href='#/rendering/" + jsonb.id + "'>view</a>",
                  css_class: "success"
                };
                ctx.redirect('#/renderings/by/date');
              }
            });
          }
        });
      });
      
      get('#/rendering/delete/:id', function() {
        var ctx = this;
        if (!confirm('Are you sure?')) {
          ctx.redirect('#/rendering/' + ctx.params["id"]);
          return false;
        }
        displayProgress();
        couchapp.db.openDoc(ctx.params["id"], {
          success: function(json) {
            var sketch_name = json.sketch.name;
            couchapp.db.removeDoc(json, {
              success: function() {
                flash = { 
                  message: "Deleted rendering of '" + sketch_name + "'",
                  css_class: "success"
                };
                ctx.redirect('#/renderings/by/date');
              }
            });
            return false;
          }
        });
      });

      get('#/manage/new', function() {
        $('#main').addClass('center');
        menuSetup('manage-new', ['Manage', 'New sketch template']);
        this.partial('views/manage/new.html');
      });

      post('#/manage/new', function() {
        displayProgress();
        var ctx = this;
        var date = new Date();
        var sketch_name = (ctx.params['sketch_name'].blank() ? ('Untitled ' + date) : ctx.params['sketch_name']);
        couchapp.db.saveDoc(
          {
            type: 'sketch',
            created_at: date.toJSON(),
            name: sketch_name,
            code: ctx.params['sketch_code'],
          }, {
            success: function(json) {
              flash = { 
                message: "Stored sketch '" + sketch_name + "'",
                css_class: "success"
              };
              ctx.redirect('#/renderings/by/date');
              return false;
            }
        });
        flash = { 
          message: "There was a problem storing your sketch",
          css_class: "error"
        };
        ctx.redirect('#/manage/new');
      });

      get('#/manage/edit/:id', function() {
        $('#main').addClass('center');
        var ctx = this;
        couchapp.db.openDoc(ctx.params["id"], {
          success: function(json) {
            //console.log(json);
            menuSetup(('#/manage/edit/' + json._id).cssify(), ['Manage', 'Edit', json.name]);
            ctx.partial('views/manage/edit.html', {
              item: json, 
              timestamp: couchapp.prettyDate(json.created_at)
            });
          }
        });
      });

      put('#/manage/edit/:id', function() {
        displayProgress();
        var ctx = this;
        var sketch_name = (ctx.params['sketch_name'].blank() ? ('Untitled ' + date) : ctx.params['sketch_name']);
        couchapp.db.openDoc(ctx.params["id"], {
          success: function(json) {
            json.code = ctx.params['sketch_code'];
            json.name = sketch_name;            
            couchapp.db.saveDoc(json, {
              success: function(json) {
               //console.log('stored doc: ', json)
                flash = { 
                  message: "Updated sketch '" + sketch_name + "'",
                  css_class: "success"
                };  
                ctx.redirect('#/renderings/by/date');
              }
            });
            return false;
          }
        });
      });

      get('#/manage/delete/:id', function() {
        var ctx = this;
        if (!confirm('Are you sure?')) {
          ctx.redirect('#/manage/edit/' + ctx.params["id"]);
          return false;
        }
        displayProgress();
        couchapp.db.openDoc(ctx.params["id"], {
          success: function(json) {
            var sketch_name = json.name;
            couchapp.db.removeDoc(json, {
              success: function() {
                flash = { 
                  message: "Deleted sketch '" + sketch_name + "'",
                  css_class: "success"
                };
                ctx.redirect('#/renderings/by/date');
              }
            });
            return false;
          }
        });
      });

      get('#/credits', function() {
        this.partial('views/credits.html', {
           list: APP_DATA.credits
         });
      });
    
    } // with(this)
  }); // Sammy#app
  
  $(function() {
    app.addLogger(function(e, data) {
      //console.log([app.toString(), app.namespace, e.cleaned_type, data]);
    });
    app.run('#/');
  });
  
})(jQuery);
