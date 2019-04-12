function $(id) {
  return document.getElementById(id);
}

function ToCommand(letter) {
  switch (letter) {
    case 'M': return 'MOVE_TO';
    case 'm': return 'R_MOVE_TO';
    case 'L': return 'LINE_TO';
    case 'l': return 'R_LINE_TO';
    case 'H': return 'H_LINE_TO';
    case 'h': return 'R_H_LINE_TO';
    case 'V': return 'V_LINE_TO';
    case 'v': return 'R_V_LINE_TO';
    case 'A': return 'ARC_TO';
    case 'a': return 'R_ARC_TO';
    case 'C': return 'CUBIC_TO';
    case 'S': return 'CUBIC_TO_SHORTHAND';
    case 'c':
    case 's':
      return 'R_CUBIC_TO';
    case 'Z':
    case 'z':
      return 'CLOSE';
  }
  return '~UNKNOWN~';
}

function LengthForCommand(letter) {
  switch (letter) {
    case 'C':
    case 'c':
    case 's':
      return 6;
    case 'S':
      return 4;
    case 'L':
    case 'l':
    case 'H':
    case 'h':
    case 'V':
    case 'v':
      return 2;
    case 'A':
    case 'a':
      return 7;
  };
  return 999;
}

function RoundToHundredths(x) {
  return Math.floor(x * 100 + 0.5) / 100;
}

function PathColorArgbFromString(string) {
  if (string.length == 4) {
    string = `#${string[1]}${string[1]}${string[2]}${string[2]}${string[3]}${string[3]}`;
  }
  return `PATH_COLOR_ARGB, 0xFF, 0x${string.substr(1, 2)}, 0x${string.substr(3, 2)}, 0x${string.substr(5, 2)},\n`;
}

function HandleNode(svgNode, transform) {
  var output = '';
  for (var idx = 0; idx < svgNode.children.length; ++idx) {
    var svgElement = svgNode.children[idx];
    var fillAttr = svgElement.getAttribute("fill");
    var strokeAttr = svgElement.getAttribute("stroke");
    if (fillAttr && fillAttr.match(/[0-9a-f]{3}|[0-9a-f]{6}/i)) {
      output += 'NEW_PATH,\n';
      output += PathColorArgbFromString(fillAttr);
    } else if (strokeAttr && strokeAttr.match(/\#[0-9a-f]{6}/i)) {
      output += 'NEW_PATH,\n';
      output += "STROKE, 1,\n";
      output += PathColorArgbFromString(strokeAttr);
    }
    switch (svgElement.tagName) {
      // g ---------------------------------------------------------------------
      case 'g':
        if (svgElement.getAttribute('transform')) {
          output += HandleNode(svgElement, transform.multiply(svgElement.transform.baseVal[0].matrix));
          break;
        }

        output += HandleNode(svgElement, transform);
        break;

      // PATH ------------------------------------------------------------------
      case 'path':
        // If fill is none, this is probably one of those worthless paths
        // of the form <path fill="none" d="M0 0h24v24H0z"/>
        var style = window.getComputedStyle(svgElement);
        if (style.fill == 'none' && style.stroke == 'none') {
          break;
        }

        var commands = [];
        var path = svgElement.getAttribute('d').replace(/,/g, ' ').trim();
        while (path) {
          var point = parseFloat(path);
          if (isNaN(point)) {
            var letter = path[0];
            path = path.substr(1);
            commands.push({ 'command': letter, 'args': [] });
          } else {
            var currentCommand = commands[commands.length - 1];
            if (currentCommand.args.length == LengthForCommand(currentCommand.command)) {
              commands.push({ 'command': currentCommand.command, 'args': [] });
              currentCommand = commands[commands.length - 1];
            }
            // Insert implicit points.
            if (currentCommand.command.toLowerCase() == 's' && currentCommand.args.length == 0) {
              if (currentCommand.command == 's') {
                var lastCommand = commands[commands.length - 2];
                if (ToCommand(lastCommand.command).search('CUBIC_TO') >= 0) {
                  // The first control point is assumed to be the reflection of
                  // the second control point on the previous command relative
                  // to the current point.
                  var lgth = lastCommand.args.length;
                  currentCommand.args.push(RoundToHundredths(lastCommand.args[lgth - 2] - lastCommand.args[lgth - 4]));
                  currentCommand.args.push(RoundToHundredths(lastCommand.args[lgth - 1] - lastCommand.args[lgth - 3]));
                } else {
                  // "If there is no previous command or if the previous command
                  // was not an C, c, S or s, assume the first control point is
                  // coincident with the current point."
                  currentCommand.args.push(0);
                  currentCommand.args.push(0);
                }
              }
            }

            // Whether to apply flipping and translating transforms to the
            // argument. Only the last two arguments (out of 7) in an arc
            // command are coordinates.
            var transformArg = true;
            var xAxis;
            if (currentCommand.command.toLowerCase() == 'a') {
              if (currentCommand.args.length < 5)
                transformArg = false;
              xAxis = currentCommand.args.length % 2 == 1;
            } else {
              xAxis = currentCommand.command.toLowerCase() != 'v' && (currentCommand.args.length % 2 == 0);
            }
            if (transformArg) {
              point *= xAxis ? transform.a : transform.d;
              if (currentCommand.command != currentCommand.command.toLowerCase())
                point += xAxis ? transform.e : transform.f;
            }
            point = RoundToHundredths(point);
            currentCommand.args.push(point);

            var dotsSeen = 0;
            for (var i = 0; i < path.length; ++i) {
              if (i == 0 && path[i] == '-')
                continue;
              if (!isNaN(parseInt(path[i])))
                continue;
              if (path[i] == '.' && ++dotsSeen == 1)
                continue;
              break;
            }
            path = path.substr(i);
          }

          path = path.trim();
        }

        for (command_idx in commands) {
          var command = commands[command_idx];
          output += ToCommand(command.command) + ', ';
          for (i in command.args) {
            var point = command.args[i];
            output += point;
            if (typeof point == 'number' && ((point * 10) % 10 != 0))
              output += 'f';
            output += ', ';
          }
          output = output.trim() + '\n';
        }
        break;

      // CIRCLE ----------------------------------------------------------------
      case 'circle':
        var cx = parseFloat(svgElement.getAttribute('cx'));
        cx *= transform.a;
        cx += transform.e;
        var cy = parseFloat(svgElement.getAttribute('cy'));
        cy *= transform.d;
        cy += transform.f;
        var rad = parseFloat(svgElement.getAttribute('r'));
        output += 'CIRCLE, ' + cx + ', ' + cy + ', ' + rad + ',\n';
        break;

      // RECT ------------------------------------------------------------------
      case 'rect':
        var x = parseFloat(svgElement.getAttribute('x')) || 0;
        x *= transform.a;
        x += transform.e;
        var y = parseFloat(svgElement.getAttribute('y')) || 0;
        y *= transform.d;
        y += transform.f;
        var width = parseFloat(svgElement.getAttribute('width'));
        var height = parseFloat(svgElement.getAttribute('height'));

        output += 'ROUND_RECT, ' + x + ', ' + y + ', ' + width + ', ' + height +
            ', ';

        var round = svgElement.getAttribute('rx');
        if (!round)
          round = '0';
        output += round + ',\n';
        break;
    }
  }
  return output;
}

function ConvertInput() {
  var translateX = parseFloat($('transform-x').value);
  var translateY = parseFloat($('transform-y').value);
  if (isNaN(translateX))
    translateX = 0;
  if (isNaN(translateY))
    translateY = 0;

  var scaleX = $('flip-x').checked ? -1 : 1;
  var scaleY = $('flip-y').checked ? -1 : 1;

  var input = $('user-input').value;
  $('svg-anchor').innerHTML = input;
  var output = '';
  var svgNode = $('svg-anchor').querySelector('svg');
  var canvasSize = svgNode.viewBox.baseVal.width;
  if (canvasSize == 0)
    canvasSize = svgNode.width.baseVal.value;
  if (canvasSize != 48)
    output += 'CANVAS_DIMENSIONS, ' + canvasSize + ',\n';

  var transform = new DOMMatrix([1, 0, 0, 1, 0, 0]);
  transform.translateSelf(translateX, translateY);
  transform.scaleSelf(scaleX, scaleY);

  output += HandleNode(svgNode, transform);
  // Truncate final comma and newline.
  $('output-span').textContent = output.slice(0, -2);
}

function init() {
  $('go-button').addEventListener('click', ConvertInput);

  if (navigator.userAgent.indexOf("WebKit") >= 0)
    $('use-webkit').hidden = true;
}

window.onload = init;
