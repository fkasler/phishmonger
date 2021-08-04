;(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory();
  } else {
    root.indent = factory();
  }
}(this, function() {
var indent = (function (root) {
  var rulesCache = {};

  function map(array, predicate) {
    var i, results = [];
    for (i=0; i<array.length; i++) {
      results.push(predicate(array[i], i, array));
    }
    return results;
  }

  function some(array, predicate) {
    var i, result;
    for (i=0; i<array.length; i++) {
      result = predicate(array[i], i, array);
      if (result) {
        return result;
      }
    }
    return false;
  }

  function filterRules(language, rules, excludes) {
    if (rulesCache[language])
      return rulesCache[language];
    var ret = [];
    rulesCache[language] = ret;
    excludes = excludes || '';
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].$languages.indexOf(language.toLowerCase()) !== -1 &&
        excludes.indexOf(rules[i].$name) === -1)
        ret.push(rules[i]);
    }
    return ret;
  }

  // String.prototype.trim polyfill for IE9
  if (!String.prototype.trim) {
    String.prototype.trim = function () {
      return this.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
    };
  }

  var NEW_LINE_REGEX = /\r*\n/;
  var HTML_TAG_RULES = ["tag", "void-tags", "html-tag"];

  /**
   * Soft dedent: this type of dedent has the opposite effect and will actually indent every line
   * starting from the opening line.
   */

  /**
   * $indent - whether rule will cause indent
   * $ignoreRules - ignore further rule matching as long as this is last active rule, e.g. string, comments
   * $consumeEndMatch - advance the cursor to the end of the end pattern matches
   * $endPatternIndent - keep the indent rule active for the $endPatterns
   * $endPatterns - list of regex to terminate the rule
   * $startPatterns - list of regex to start the rule
   * $matchBeginning - match at beginning of line only
   * $languages - used to filter by language later
   * $lineOffset - added to the line field when rule is applied
   * $excludeIf - used to exclude rule matching if any of these rules are active
   * $lastRule - used to continue a previous rule
   * $newScope - used to determine if rule creates a new scope, used for lastRule
   *
   * Always keep NEW_LINE_REGEX $endPatterns as last element,
   * as otherwise it will be matched first, and subsequent ones may be ignored
   * and skipped permanently by other rules.
   */
  var MASTER_RULES = [
    {
      $languages: "js html",
      $name: "comment",
      $startPatterns: [/\<\!\-\-/],
      $endPatterns: [/\-\-\>/],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "html",
      $name: "doctype",
      $startPatterns: [/\<\!doctype html>/i],
      $endPatterns: [NEW_LINE_REGEX],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js html",
      $name: "void-tags",
      $startPatterns: [
        /\<(area|base|br|col|command|embed|hr|img|input|keygen|link|menuitem|meta|param|source|track|wbr)/i],
      $endPatterns: [/>/],
      $indent: true,
      $consumeEndMatch: true
    },
    {
      $languages: "html",
      $name: "mode switch js",
      $startPatterns: [function (string) {
        var start = /<script[\s>].*/i;
        var end = /<\/script>/i;
        var startMatch = start.exec(string);
        var endMatch = end.exec(string);

        if (startMatch && (!endMatch || endMatch.index < startMatch.index)) {
          return {
            matchIndex: startMatch.index,
            length: startMatch[0].length
          };
        }
        return null;
      }],
      $endPatterns: [/<\/script>/i],
      $switchRules: "js",
      $consumeEndMatch: true,
      $indent: true,
      $newScope: true
    },
    {
      $languages: "html",
      $name: "mode switch css",
      $startPatterns: [function (string) {
        var start = /<style[\s>].*/i;
        var end = /<\/style>/i;
        var startMatch = start.exec(string);
        var endMatch = end.exec(string);

        if (startMatch && (!endMatch || endMatch.index < startMatch.index)) {
          return {
            matchIndex: startMatch.index,
            length: startMatch[0].length
          };
        }
        return null;
      }],
      $endPatterns: [/<\/style>/i],
      $switchRules: "css",
      $consumeEndMatch: true,
      $indent: true,
      $newScope: true
    },
    {
      $languages: "html",
      $name: "html-tag",
      $startPatterns: [/<html[^A-Za-z0-9]/i],
      $endPatterns: [/<\/html>/i],
      $consumeEndMatch: true
    },
    {
      $languages: "js html",
      $name: "tag",
      $startPatterns: [function (string, rule, state) {
        var re = /<([A-Za-z:][A-Za-z0-9\-\.:]*)/;
        var match = string.match(re);
        if (match) {
          state.openingTag = match[1];
          return {
            matchIndex: match.index,
            length: match[0].length
          }
        } else {
          return null;
        }
      }],
      $endPatterns: [function (string, rule, state) {
        var re = new RegExp("<\/" + state.openingTag + ">|\\s\/>", "i");
        var match = string.match(re);
        if (match) {
          return {
            matchIndex: match.index,
            length: match[0].length
          }
        } else {
          return null;
        }
      }],
      $indent: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js",
      $name: "line-comment",
      $startPatterns: [/\/\//],
      $endPatterns: [NEW_LINE_REGEX],
      $ignoreRules: true
    },
    {
      $languages: "js css",
      $name: "block-comment",
      $startPatterns: [/\/\*/],
      $endPatterns: [/\*\//],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js",
      $name: "regex",
      $startPatterns: [function (string, rule) {
        var re = /[(,=:[!&|?{};][\s]*\/[^/]|^[\s]*\/[^/]/;
        var startIndex = string.search(re);
        if (startIndex != -1) {
          startIndex = string.indexOf('/', startIndex);
          var substr = string.substring(startIndex + 1);
          var match = searchAny(substr, rule.$endPatterns, rule);
          if (match.matchIndex != -1) {
            substr = substr.substring(0, match.matchIndex);
            try {
              (new RegExp(substr));
              return {
                matchIndex: startIndex,
                length: 1
              };
            }
            catch (e) {
              return null;
            }
          }
        }
        return null;
      }],
      $endPatterns: [function (string) {
        var fromIndex = 0;
        var index = string.indexOf('/');
        while (index != -1) {
          try {
            (new RegExp(string.substring(0, index)));
            break;
          }
          catch (e) {
            index = string.indexOf('/', fromIndex);
            fromIndex = index + 1;
          }
        }
        return index === -1 ? null : {
          matchIndex: index,
          length: 1
        };
      }],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js html",
      $name: "quotes",
      $excludeIf: HTML_TAG_RULES,
      $startPatterns: [/"/],
      $endPatterns: [/"/, NEW_LINE_REGEX],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js html",
      $name: "quotes",
      $excludeIf: HTML_TAG_RULES,
      $startPatterns: [/'/],
      $endPatterns: [/'/, NEW_LINE_REGEX],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js css",
      $name: "string",
      $startPatterns: [/(''|""|``)/],
      $endPatterns: [/./, NEW_LINE_REGEX]
    },
    {
      $languages: "js css",
      $name: "string",
      $startPatterns: [/\"(?=[^"])/],
      $endPatterns: [/[^\\]\"/, NEW_LINE_REGEX],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js css",
      $name: "string",
      $startPatterns: [/\'(?=[^'])/],
      $endPatterns: [/[^\\]\'/, NEW_LINE_REGEX],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js css",
      $name: "string",
      $startPatterns: [/\`(?=[^`])/],
      $endPatterns: [/[^\\]\`/],
      $ignoreRules: true,
      $consumeEndMatch: true
    },
    {
      $languages: "js",
      $name: "if",
      $startPatterns: [/^if\s*(?=\()/, /[\s]+if\s*(?=\()/],
      $endPatterns: [/else[\s]+/, nonWhitespaceFollowByNewline, /[{;]/],
      $indent: true
    },
    {
      $languages: "js",
      $name: "for|while",
      $startPatterns: [/^(for|while)\s*(?=\()/],
      $endPatterns: [nonWhitespaceFollowByNewline, /[{;]/],
      $indent: true
    },
    {
      $languages: "js",
      $name: "else",
      $startPatterns: [/else[\s]+/],
      $endPatterns: [/if[^\w$]/, nonWhitespaceFollowByNewline, /[{;]/],
      $indent: true
    },
    {
      $languages: "js css",
      $name: "bracket",
      $startPatterns: [/\(\s*(var|let|const)?\s*/],
      $endPatterns: [/\)/],
      $indent: true,
      $consumeEndMatch: true,
      $newScope: true
    },
    {
      $languages: "js",
      $name: "dot-chain",
      $startPatterns: [/^\.[A-Za-z$_]/],
      $endPatterns: [/[\.;]/, NEW_LINE_REGEX],
      $indent: true,
      $matchBeginning: true,
      $lineOffset: -1
    },
    {
      $languages: "js",
      $name: "dot-chain",
      $startPatterns: [/\.\s*\r*\n/],
      $endPatterns: [/[\.;})\]]/, /[^\s]\s*\r*\n/],
      $indent: true
    },
    {
      $languages: "js css",
      $name: "array",
      $startPatterns: [/\[/],
      $endPatterns: [/\]/],
      $indent: true,
      $consumeEndMatch: true,
      $newScope: true
    },
    {
      $languages: "js css",
      $name: "block",
      $startPatterns: [/\{/],
      $endPatterns: [/\}/],
      $indent: true,
      $consumeEndMatch: true,
      $newScope: true
    },
    {
      $languages: "js",
      $name: "var/let/const",
      $startPatterns: [/(var|let|const)[\s]*\r*\n/],
      $endPatterns: [nonWhitespaceFollowByNewline],
      $indent: true,
      $endPatternIndent: true
    },
    {
      $languages: "js",
      $name: "var/let/const",
      $startPatterns: [/(var|let|const)\s+(?=[\w$])/],
      $endPatterns: [/[,;=]/, nonWhitespaceFollowByNewline],
      $indent: true
    },
    {
      $languages: "js",
      $name: "var/let/const",
      $lastRule: ["var/let/const", "="],
      $startPatterns: [/,[\s]*\r*\n/],
      $endPatterns: [/[,;]/, nonWhitespaceFollowByNewline],
      $indent: true,
      callback: postIndentForCommaAfterEqual
    },
    {
      $languages: "js",
      $name: "var/let/const",
      $lastRule: ["var/let/const", "="],
      $startPatterns: [/^,/],
      $endPatterns: [/[,;]/, nonWhitespaceFollowByNewline],
      $matchBeginning: true,
      $indent: true,
      $lineOffset: -1,
      callback: postIndentForCommaAfterEqual
    },
    {
      $languages: "js",
      $name: "equality",
      $startPatterns: [/[=<>!]=(=)?/],
      $endPatterns: [/./]
    },
    {
      $languages: "js",
      $name: "=",
      $excludeIf: HTML_TAG_RULES,
      $startPatterns: [/=/],
      $endPatterns: [/[,;\)\]}]/, NEW_LINE_REGEX]
    },
    {
      $languages: "js",
      $name: "?:",
      $startPatterns: [/\?/],
      $endPatterns: [/[:;]/],
      $endPatternIndent: true,
      $indent: true
    },
    {
      $languages: "js",
      $name: "case",
      $startPatterns: [/^(case|default)[\s:]/],
      $endPatterns: [/break[\s;\r\n]/, /^return[\s;\r\n]/, /^case[\s]+/, /^default[\s:]/, /}/],
      $endPatternIndent: function (matchEnd) {
        return matchEnd.endPatternIndex <= 1;
      },
      $indent: true,
      $newScope: true
    },
    {
      $languages: "js",
      $name: "semicolon",
      $startPatterns: [/;/],
      $endPatterns: [/./]
    }
  ];

  return {
    css: function (code, options) {
      return indent(code, filterRules('css', MASTER_RULES), options);
    },
    js: function (code, options) {
      return indent(code, filterRules('js', MASTER_RULES), options);
    },
    ts: function (code, options) {
      return indent(code, filterRules('js', MASTER_RULES), options);
    },
    html: function (code, options) {
      var rules = options && options.indentHtmlTag ?
        filterRules('html', MASTER_RULES, 'html-tag') : filterRules('html', MASTER_RULES);
      return indent(code, rules, options);
    }
  };


  function indent(code, baseRules, options) {
    code = code || '';
    /**
     * Algorithm assumptions
     *
     * indentDeltas - store the the deltas in tabString
     *              - can be manipulated directly to alter the tabString
     * indentBuffer - used to keep tabs on the number of open indentations on each line
     * dedentBuffer - each line in the buffer has an array storing open indent lines to be closed
     *              - an array of numbers is used to reference the opening line
     *              - a negative number is used to signify a soft dedent (see note about soft dedent)
     *
     * Each line can create at most 1 tabString.
     * When a line is 'used up' for dedent, it cannot be used again, hence the indentBuffer.
     */
    var tabString = options && options.tabString != null ? options.tabString : '\t';
    var lines = code.split(/[\r]?\n/gi);
    var lineCount = lines.length;
    var ignoreBuffer = intArray(lineCount);
    var indentBuffer = intArray(lineCount);
    var dedentBuffer = arrayOfArrays(lineCount);
    var activeMatches = [];
    var lastMatches= [null];
    var l = 0;
    var pos = 0;
    var matchEnd, matchStart;
    var modeRules = null;
    var line, lineToMatch, activeMatch;

    if (options) {
      options.debug = {
        buffers: {
          ignore: ignoreBuffer,
          indent: indentBuffer,
          dedent: dedentBuffer,
          active: activeMatches
        }
      };
    }

    while (l < lineCount) {
      line = lines[l].trim();
      lineToMatch = cleanEscapedChars(line) + '\r\n';
      activeMatch = activeMatches[activeMatches.length-1];

      matchStart = matchStartRule(lineToMatch, modeRules || baseRules, pos);

      if (activeMatches.length) {
        matchEnd = matchEndRule(lineToMatch, activeMatch, pos, matchStart);
        if (matchEnd.matchIndex === -1) {
          if (activeMatch.rule.$ignoreRules) {
            // last rule is still active, and it's telling us to ignore.
            ignoreBuffer[l] = 1;
            l++; pos = 0;
            continue;
          }
        }
        else if (
          activeMatch.rule.$ignoreRules ||
          matchStart.matchIndex === -1 ||
          matchEnd.matchIndex <= matchStart.matchIndex) {
          removeCurrentRule();
          pos = matchEnd.cursor;
          continue;  // Repeat process for matching line start/end
        }
      }

      if (matchStart.matchIndex !== -1) {
        implementRule(matchStart);
      }
      else {
        // No new token match end, no new match start
        l++; pos = 0;
      }
    }

    var
      hardIndentCount,
      dedentLines, dedentLine, dedents,
      i, j, indents = 0,
      hardIndents = copyIntArray(indentBuffer),
      indentDeltas = intArray(lineCount),
      newLines = [];

    for (i=0; i<lineCount; i++) {
      dedentLines = dedentBuffer[i];
      dedents = 0;
      for (j=0; j<dedentLines.length; j++) {
        dedentLine = dedentLines[j];
        if (dedentLine < 0) {
          if (-dedentLine !== i) {
            indentDeltas[-dedentLine]++;
            dedents += 1;
          }
        }
        else if (hardIndents[dedentLine] > 0) {
          hardIndents[dedentLine]--;
          dedents += dedentLine !== i;
        }
      }
      hardIndentCount = hardIndents[i];
      indentDeltas[i] = hardIndentCount > dedents ? 1 :
        (hardIndentCount < dedents ? hardIndentCount - dedents : 0);
      hardIndents[i] = hardIndentCount > 0 ? 1 : 0;
    }

    for (i=0; i<lineCount; i++) {
      if (ignoreBuffer[i-1] === 1 && ignoreBuffer[i] === 1) {
        newLines.push(lines[i]);
      } else {
        indents += indentDeltas[i] || 0;
        newLines.push((indents > 0 ? repeatString(tabString, indents) : '') + lines[i].trim());
      }
    }

    return newLines.join('\r\n');


    function implementRule(match) {
      pos = match.cursor;

      var rule = match.rule;
      var line = (l + 1) + (rule.$lineOffset || 0);
      match.line = line;
      activeMatches.push(match);

      if (rule.$indent) {
        indentBuffer[line]++;
      }
      if (rule.$switchRules) {
        modeRules = filterRules(rule.$switchRules, MASTER_RULES);
      }
      if (rule.$newScope) {
        lastMatches.push(null);
      }
      if (rule.callback) {
        rule.callback(match, indentBuffer, dedentBuffer);
      }
    }

    function removeCurrentRule() {
      var match = activeMatches.pop(),
        line = match.line,
        rule = match.rule;

      if (rule.$indent) {
        var endPatternIndent = typeof rule.$endPatternIndent === 'function' ?
          rule.$endPatternIndent(matchEnd) : rule.$endPatternIndent;
        var offset = !endPatternIndent && matchEnd.matchIndex === 0 ? 0 : 1;
        if (dedentBuffer[l + offset]) dedentBuffer[l + offset].push(line);
      }
      if (rule.$switchRules) {
        modeRules = null;
      }
      if (rule.$newScope) {
        lastMatches.pop();
      }
      lastMatches[lastMatches.length - 1] = match;
    }

    function matchStartRule(string, rules, index) {
      string = string.substring(index, string.length);
      var result = null;
      var minIndex = string.length;
      var minMatch;
      var match;

      var lastMatch = lastMatches[lastMatches.length - 1];
      var lastRuleInScope = lastMatch ? lastMatch.rule.$name : '';
      var activeRules =  map(activeMatches, function (match) {
        return match.rule.$name;
      }).join('\n');  // Use \n as a special delimiter for rule names

      for (var rule, r = 0; r < rules.length; r++) {
        rule = rules[r];
        if (rule.$excludeIf && some(rule.$excludeIf, function (excludeRule) {
            return activeRules.indexOf(excludeRule) != -1;
          })) {
        } else if (!rule.$lastRule ||
            (lastRuleInScope && rule.$lastRule.indexOf(lastRuleInScope) !== -1)
        ) {
          match = searchAny(string, rule.$startPatterns, rule);
          if (match.matchIndex != -1 && match.matchIndex < minIndex
            && (!rule.$matchBeginning || index === 0)) {
            minIndex = match.matchIndex;
            minMatch = match;
            result = rule;
          }
        }
      }
      return {
        rule: result,
        relativeIndex: result ? minIndex : -1,
        matchIndex: result ? minIndex + index : -1,
        cursor: result ? index + minMatch.cursor : -1,
        state: minMatch ? minMatch.state : {},
        lastMatch: lastMatch
      };
    }

    function matchEndRule(string, active, offset, matchStart) {
      string = string.substr(offset, string.length);
      var rule = active.rule;
      var match = searchAny(string, rule.$endPatterns, rule, active.state, matchStart);
      var cursor = rule.$consumeEndMatch ? match.cursor : match.matchIndex;
      return {
        endPatternIndex: match.endPatternIndex,
        matchIndex: match.matchIndex === -1 ? -1 : match.matchIndex + offset,
        cursor: cursor === -1 ? -1 : cursor + offset,
        state: match.state
      };
    }
  }

  function arrayOfArrays(length) {
    var array = new Array(length);
    for (var i=0; i<length; i++) array[i] = [];
    return array;
  }

  function intArray(length) {
    if (root.Int16Array) {
      return new Int16Array(length);
    } else {
      var array = new Array(length);
      for (var i=0; i<length; i++) array[i] = 0;
      return array;
    }
  }

  function copyIntArray(src) {
    var copy = intArray(src.length);
    for (var i=0; i<src.length; i++) {
      copy[i] = src[i];
    }
    return copy;
  }

  function repeatString(baseString, repeat) {
    return (new Array(repeat + 1)).join(baseString);
  }

  function cleanEscapedChars(string) {
    return string.replace(/\\(u[0-9A-Za-z]{4}|u\{[0-9A-Za-z]{1,6}]\}|x[0-9A-Za-z]{2}|.)/g, '0');
  }

  function postIndentForCommaAfterEqual(match, indentBuffer, dedentBuffer) {
    var lastMatch = match.lastMatch;
    if (lastMatch && lastMatch.rule.$name === "=") {
      dedentBuffer[match.line].push(-lastMatch.line);
    }
  }

  function nonWhitespaceFollowByNewline(string, rule, state, matchStart) {
    var index;
    if (!state.newline) {
      index = string.search(/[^\s\r\n\{\(\[]/);
      state.newline = index !== -1 && (index <= matchStart.relativeIndex || matchStart.relativeIndex === -1);
    } else {
      index = string.search(/[;,=]?\r*\n/);
      if (index !== -1) {
        return {
          matchIndex: index,
          length: 1
        }
      }
    }
    return null;
  }

  function searchAny(string, patterns, rule, state, matchStart) {
    state = state || {};

    var index = -1,
      length = 0,
      match;

    for (var pat, p = 0; p < patterns.length; p++) {
      pat = patterns[p];
      if (typeof pat === 'function') {
        match = pat(string, rule, state, matchStart);
        if (match) {
          index = match.matchIndex;
          length = match.length;
          break;
        }
      }
      else {
        match = string.match(pat);
        if (match) {
          index = string.search(pat);
          length = match[0].length;
          break;
        }
      }
    }
    return {
      endPatternIndex: p,
      matchIndex: index,
      cursor: index + length,
      state: state
    };
  }
}(this));

return indent;
}));

