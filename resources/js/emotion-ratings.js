/**
 *********************************
 * Emotions Rating - Yanci Nerio *
 *********************************
 * Emotions Rating
 * Version: 2.0.1
 * URL: https://github.com/YanNerio/emotion-ratings
 * Description: This plugin allows you to create ratings using emojis
 * Requires: >= 1.9
 * Author: Yanci Nerio (www.yancinerio.com)
 * License: MIT
 */

 ;(function($, document, window, undefined) {
    // Optional, but considered best practice by some
    "use strict";

    // Name the plugin so it's only in one place
    var pluginName = 'emotionsRating';
    var $element;
    // Default options for the plugin as a simple object
    var defaults = {
        bgEmotion: "happy",
        count: 5,
        color: "#d0a658;",
        emotionSize: 30,
        inputName: "ratings[]",
        emotionOnUpdate: null,
        ratingCode: 5,
        disabled: false,
        useCustomEmotions: false,
        transformImages: false,
    };
    //the collection of emotions to show on the ratings
    var emotionsArray = {
        angry: "&#x1F620;",
        disappointed: "&#x1F61E;",
        meh: "&#x1F610;", 
        happy: "&#x1F60A;",
        smile: "&#x1F603;",
        wink: "&#x1F609;",
        laughing: "&#x1F606;",
        inlove: "&#x1F60D;",
        heart: "&#x2764;",
        crying: "&#x1F622;",
        star: "&#x2B50;",
        poop: "&#x1F4A9;",
        cat: "&#x1F63A;",
        like: "&#x1F44D;",
        dislike: "&#x1F44E;"
      };

    // Plugin constructor
    // This is the boilerplate to set up the plugin to keep our actual logic in one place
    function Plugin(element, options) {
        this.element = element;
        // Merge the options given by the user with the defaults
        this.settings = $.extend( {}, defaults, options );
        // Attach data to the element
        this.$el      = $(element);
        this.$el.data(name, this);

        this._defaults = defaults;
        this._name = pluginName;

        var meta      = this.$el.data(name + '-opts');
        this.opts     = $.extend(this._defaults, options, meta);

        this.containerCode = this.$el.attr('id');
        this.elementContainer = $(element);
        this.styleCode = 'emotion-style-'+this.containerCode;
        this.containerCode = 'emotion-container-'+this.containerCode;
        this.code = 'emoji-rating-'+this.containerCode;
        
        this.clicked = [];
        this.clicked[this.containerCode] = false;
        this.init();

    }
    
    //Avoiding conflicts with prototype
    $.extend(Plugin.prototype = {
        // Public functions accessible to users
        // Prototype methods are shared across all elements
        // You have access to this.settings and this.element
        init: function() {
            $element = $(this.element);
            this.count = 0;
            this.emotionStyle();
            this.renderEmotion();            
            this.manageHover();
            this.manageClick();
        },
        emotionStyle: function() {
            var styles = "."+this.styleCode+"{margin-right:3px;border-radius: 50%;cursor:pointer;opacity:0.3;display: inline-block;font-size:"
                 + this.settings.emotionSize +"px; text-decoration:none;line-height:0.9;text-align: center;color:"+this.settings.color+"}";
            $element.append("<style>" + styles + "</style>");
        },
        renderEmotion: function () {
            var count = this.settings.count;
            var useCustomEmotions = this.settings.useCustomEmotions;
            var bgEmotion = emotionsArray[this.settings.bgEmotion];

            if(useCustomEmotions){
              bgEmotion = "<img src='"+this.settings.bgEmotion+"' class='custom-"+this.styleCode+"'>";
            }

            var container = "<div class='"+this.containerCode+"'>";
            var emotionDiv;
            for (var i = 1; i <= count; i++) {
                emotionDiv = "<div class='"+this.styleCode+"' data-index='" + i + "'>"+bgEmotion+"</div>";
                container += emotionDiv;
            }
            container += "</div>";
            $element.append(container);
            if(this.settings.initialRating > 0){
                this.initalRate(this.settings.initialRating);
            }else{
                this.appendInput();
            }

            if(this.settings.transformImages){
                this.transformImgsToSVG();
            }
        },
        clearEmotion: function(content) {
            if(!this.settings.disabled){
                var useCustomEmotions = this.settings.useCustomEmotions;
                var bgEmotion = emotionsArray[content];

                if(useCustomEmotions){
                  bgEmotion = "<img src='"+this.settings.bgEmotion+"' class='custom-"+this.styleCode+"'>";
                }

                this.elementContainer.find("."+this.styleCode+"").each( function() {
                      $(this).css("opacity", 0.3);
                      $(this).html(bgEmotion);
                });
            }
        },
        showEmotion: function(count) {
            this.clearEmotion(this.settings.bgEmotion);
            var useCustomEmotions = this.settings.useCustomEmotions;
            var emotion = getEmotion(this.settings.emotions,count,useCustomEmotions);

            if(useCustomEmotions){
              emotion = this.settings.emotions[emotion];
              emotion = "<img src='"+emotion+"' class='custom-"+this.styleCode+"'>";
            }

            for (var i = 0; i < count; i++) {               
                this.elementContainer.find("."+this.styleCode+"").eq(i).css("opacity", 1);
                this.elementContainer.find("."+this.styleCode+"").eq(i).html(emotion);
            }
            if(this.settings.transformImages){
                this.transformImgsToSVG();
            }
            
        },
        manageHover: function() {
            var self = this;
            if(!self.settings.disabled && !self.settings.transformImages){
                
                this.elementContainer.on({
                    mouseenter: function() {
                        var count = parseInt($(this).data("index"), 10);
                        if (self.clicked[self.containerCode]) {
                            return;
                        }
                        self.showEmotion(count);
                    },
                    mouseleave: function() {
                        if (!self.clicked[self.containerCode]) {
                            self.clearEmotion();
                        }
                    }
                }, "."+this.styleCode+"" );
            }
        },
        manageClick: function() {
            var self = this;
            if(!self.settings.disabled){
                
                this.elementContainer.on("click", "."+this.styleCode+"", function() {
                    var index = $(this).data("index"),
                    count = parseInt(index, 10);
                    self.showEmotion(count);
                    self.count = count;
                    if (!self.clicked[self.containerCode]) {
                        self.updateInput(count);
                        self.clicked[self.containerCode] = true;
                    } else {
                        self.updateInput(count);
                    }
                    if ($.isFunction(self.settings.onUpdate)) {
                        self.settings.onUpdate.call(self, count);
                    }
                });
            }
        }, 
        initalRate: function(count) {
            var self = this;           
            self.showEmotion(count);
           if (!self.clicked[self.containerCode]) {
                self.appendInput(count);
                self.clicked[self.containerCode] = true;
            }
        },        
        appendInput: function(count) {
            var total = '';
            if(!count){
                total = count;
            }
            var _input = "<input type='hidden' class='"+ this.code +"' name='" + this.settings.inputName + 
                    "' value='" + total + "' />";
            
            var div = this.elementContainer;
            div.append(_input);
        },
        updateInput: function(count) {
            var _input = this.elementContainer.find("input."+this.code+"");

            _input.val(count);
        },
        transformImgsToSVG: function(){
            // Based in https://bit.ly/2S5Onvx
            this.elementContainer.find('img[src$=".svg"]').each(function(){
                var $img = jQuery(this);
                var imgURL = $img.attr('src');
                var attributes = $img.prop("attributes");

                $.get(imgURL, function(data) {
                  // Get the SVG tag, ignore the rest
                  var $svg = jQuery(data).find('svg');

                  // Remove any invalid XML tags
                  $svg = $svg.removeAttr('xmlns:a');

                  // Loop through IMG attributes and apply on SVG
                  $.each(attributes, function() {
                    $svg.attr(this.name, this.value);
                  });

                  // Replace IMG with SVG
                  $img.replaceWith($svg);
                }, 'xml');

            });
        }
    });

    $.fn[pluginName] = function(options) {
        // Iterate through each DOM element and return it
        return this.each(function() {
            // prevent multiple instantiations
            if (!$.data(this, 'plugin_' + pluginName)) {
                $.data(this, 'plugin_' + pluginName, new Plugin(this, options));
            }
        });
    };

    var getEmotion = function(_emotions,count, onlyIndex = false) {
        var emotion;
        var emotionsLength = _emotions.length;
        if (emotionsLength == 1) {
            emotion = onlyIndex ? 0 : emotionsArray[_emotions[0]];
        }else{
          var emotionIndex = (count-1);
          emotion = onlyIndex 
                  ? (emotionIndex > (emotionsLength-1)) 
                      ? (emotionsLength-1) : emotionIndex 
                  : emotionsArray[_emotions[count-1]];
        }
        return emotion;
    }

})(jQuery, document, window);
