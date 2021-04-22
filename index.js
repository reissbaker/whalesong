'use strict';

let prevMouseX, prevMouseY, state, segments;

const MIN_FREQ = 120;
const MAX_FREQ = 500;

const HUE = 233;
const SATURATION = 100;

const UNKNOWN_DIR = 0;
const LEFT_DIR = -1;
const RIGHT_DIR = 1;

function setup() {
  // Bind event handlers
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.mousePressed(mousePressed);

  // Set up initial segments
  segments = new Segments();
  segments.genOscillator();

  // Start tracking mouse movements
  prevMouseX = mouseX;
  prevMouseY = mouseY;
}

function draw() {
  // Fuck RGB
  colorMode(HSL, 360, 100, 100);

  background(45, SATURATION, 75);
  if(!state) setState(playback);

  segments.draw();
  state.draw();

  // Update mouse tracking every frame
  prevMouseX = mouseX;
  prevMouseY = mouseY;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function mousePressed() {
  setState(drawing);
}

function mouseReleased() {
  setState(playback);
}

// Handles storing, drawing, and playing back segments
class Segments {
  constructor() {
    this.oscs = [];
    this.currOsc = null;
    this.store = new SegmentsStore();
  }

  /*
  Generate a new oscillator. This allows multiple tones to be played
  at the same time.
  */
  genOscillator() {
    if(this.currOsc) this.currOsc.mute();
    this.currOsc = new SegmentsOscillator();
    this.oscs.push(this.currOsc);
    return this.currOsc;
  }

  // Generate a new line segment
  genSegment(startX, startY, endX, endY) {
    const segment = this.store.recordSegment(startX, startY, endX, endY);
    this.currOsc.addSegment(segment);
    return segment;
  }

  // Draw all the segments
  draw() {
    this.store.draw();
  }

  // Mute all the segments
  muteAll() {
    for(const osc of this.oscs) {
      osc.mute();
    }
  }

  // Play the sounds for all the segments at the given scrubber position
  play(scrubber) {
    for(const osc of this.oscs) {
      osc.play(scrubber);
    }
  }

  // Play the frequency that the current y position symbolizes
  playFreq(yPos) {
    this.currOsc.playFreq(yPos);
  }
}

class SegmentsStore {
  constructor() {
    this.segments = [];
  }

  recordSegment(startX, startY, endX, endY) {
    // Store the line with the leftmost point first. This makes drawing easier later
    // since quads need to be given clockwise
    const startPoint = [startX, startY];
    const endPoint = [endX, endY];
    const minPoint = startX < endX ? startPoint : endPoint;
    const maxPoint = minPoint === startPoint ? endPoint : startPoint;
    const segment = [...minPoint, ...maxPoint];

    this.segments.push(segment);

    // Keep the segments sorted by y-position, so that we can treat taller rects
    // as being drawn further back in the z-position (painter's algorithm)
    this.segments.sort((a, b) => {
      const maxA = Math.max(a[1], a[3]);
      const maxB = Math.max(b[1], b[3]);
      return maxA - maxB;
    });

    return segment;
  }

  draw() {
    for(const segment of this.segments) {
      const [startX, startY, endX, endY] = segment;
      const maxY = Math.max(startY, endY);
      const luminosity = map(maxY, windowHeight, 0, 20, 80);
      const lineColor = color(HUE, SATURATION, luminosity);
      fill(lineColor);
      noStroke();
      quad(startX, startY, endX, endY, endX, windowHeight, startX, windowHeight);

      // Draw a little lighter line on top of the rect for visual clarity
      strokeWeight(1);
      stroke(HUE, SATURATION, luminosity + 10);
      line(startX, startY, endX, endY);
    }
  }
}

class SegmentsOscillator {
  constructor() {
    this.segments = [];
    this.osc = new p5.Oscillator('sine');
    this.started = false;
    this.muted = false;
    this.mute();
  }

  addSegment(segment) {
    this.segments.push(segment);
  }

  play(scrubber) {
    let hit = false;
    let freq = 0;
    for(const segment of this.segments) {
      const [startX, startY, endX, endY] = segment;
      // If we're within the bounds, draw the intersection line
      // and record the frequency
      if(
        (startX <= scrubber && endX >= scrubber) ||
        (startX >= scrubber && endX <= scrubber)
      ) {
        const rise = endY - startY;
        const run = endX - startX;
        const slope = rise / run;
        const intersectY = (scrubber - startX) * slope + startY;
        freq = intersectY;
        hit = true;
        strokeWeight(2);
        stroke(0, SATURATION, 0);
        line(scrubber, intersectY, scrubber, intersectY);
        break;
      }
    }
    if(hit) {
      this.playFreq(freq);
    }
    else {
      this.mute();
    }
  }

  playFreq(yPos) {
    this.unmute();
    const flippedY = windowHeight - yPos;
    this.osc.freq(map(flippedY * flippedY, 0, windowHeight * windowHeight, MIN_FREQ, MAX_FREQ));
  }

  mute() {
    if(!this.muted) this.osc.amp(0);
    this.muted = true;
  }

  unmute() {
    if(!this.started) this.osc.start();
    this.started = true;
    this.osc.amp(0.5);
    this.muted = false;
  }
}

/*
State handling:

We have two states, drawing and playback. Define objects to encapsulate
behavior in each one, so we can just set the state once and not have
a zillion if statements littered about.
*/
const drawing = {
  dir: UNKNOWN_DIR,

  start() {
    // Reset mouse directionality as soon as we start drawing.
    this.dir = UNKNOWN_DIR;
  },

  stop() {
    segments.genOscillator();
  },

  draw() {
    // Figure out if we've changed direction since the last tick
    // If we have, that means we now have two tones for the same
    // scrubber position, so we need to generate a new oscillator
    switch(this.dir) {
      // If our prev dir was unknown, by definition we did not change
      case UNKNOWN_DIR:
        if(isMovingLeft()) this.dir = LEFT_DIR;
        else if(isMovingRight()) this.dir = RIGHT_DIR;
        break;
      // Prev right, check if we're now left
      case RIGHT_DIR:
        if(isMovingLeft()) {
          segments.genOscillator();
          this.dir = LEFT_DIR;
        }
        break;
      // Prev left, check if we're now right
      case LEFT_DIR:
        if(isMovingRight()) {
          segments.genOscillator();
          this.dir = RIGHT_DIR;
        }
        break;
    }

    // Always create the segment and play its frequency
    segments.genSegment(prevMouseX, prevMouseY, mouseX, mouseY);
    segments.playFreq(mouseY);
  },
}

const playback = {
  scrubberIndex: 0,
  start() {},
  stop() {
    // Mute everything when we stop playback
    segments.muteAll();
  },
  draw() {
    // Draw the scrubber
    strokeWeight(3);
    stroke(0, 100, 100);
    line(this.scrubberIndex, 0, this.scrubberIndex, windowHeight);

    // Play the tones. Awkwardly despite the name this
    // also draws the intersection lines on the scrubber
    segments.play(this.scrubberIndex);

    this.scrubberIndex += 3;
    if(this.scrubberIndex > windowWidth) {
      this.scrubberIndex = 0;
    }
  },
}

function setState(newState) {
  if(state) state.stop();
  state = newState;
  state.start();
}

function isMovingLeft() {
  return mouseX < prevMouseX;
}

function isMovingRight() {
  return mouseX > prevMouseX;
}