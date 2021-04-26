'use strict';

let prevMouseX, prevMouseY, state, segments;

const MIN_FREQ = 120;
const MAX_FREQ = 500;

const HUE = 233;
const SATURATION = 100;

const UNKNOWN_DIR = 0;
const LEFT_DIR = -1;
const RIGHT_DIR = 1;

const NOISE_SCALE = 40;
const NOISE_INTERVAL = 0.01;

const instructions = {
  hidden: false,
  hide() {
    if(this.hidden) return;
    const element = document.getElementById("instructions");
    element.style.display = 'none';
    this.hidden = true;
  }
};

function setup() {
  // Bind event handlers
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.mousePressed(mousePressed);

  // Set up initial segments
  segments = new Segments();
  segments.newShape();

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
  instructions.hide();
  setState(drawing);
}

function mouseReleased() {
  setState(playback);
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
    segments.stopShape();
    segments.newShape();
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
          segments.newShape();
          this.dir = LEFT_DIR;
        }
        break;
      // Prev left, check if we're now right
      case LEFT_DIR:
        if(isMovingRight()) {
          segments.newShape();
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

// Handles storing, drawing, and playing back segments
class Segments {
  constructor() {
    this.oscs = [];
    this.currOsc = null;
    this.currNoiseGen = new NoiseGenerator();
    this.noiseGens = [this.currNoiseGen];
    this.store = new SegmentsStore();
  }

  /*
  Generate a new oscillator. This allows multiple tones to be played
  at the same time.
  */
  newShape() {
    if(this.currOsc) this.currOsc.mute();
    this.currOsc = new SegmentsOscillator();
    this.oscs.push(this.currOsc);

    this.currNoiseGen = new NoiseGenerator();
    this.noiseGens.push(this.currNoiseGen);

    return this.currOsc;
  }

  // Generate a new line segment
  genSegment(startX, startY, endX, endY) {
    const segment = this.store.recordSegment(startX, startY, endX, endY, this.currNoiseGen);
    this.currOsc.addSegment(segment);
    return segment;
  }

  stopShape() {
    this.currNoiseGen.start();
  }

  // Draw all the segments
  draw() {
    this.noiseGens.forEach(noiseGen => noiseGen.generate());
    // Re-sort to make sure noise is accounted for
    this.store.sort();

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

class NoiseGenerator {
  constructor() {
    this.offset = 0;
    this.noiseSeed = 0;
    this.started = false;
  }
  generate() {
    if(!this.started) return;
    if(state === drawing) return;
    this.noiseSeed += NOISE_INTERVAL;
    this.offset = noise(this.noiseSeed);
  }

  noise() {
    if(!this.started) return 0;
    return (this.offset * NOISE_SCALE) - (NOISE_SCALE / 2);
  }

  start() {
    this.started = true;
  }
}

class Segment {
  constructor(startX, startY, endX, endY, noiseGen) {
    // Store the line with the leftmost point first. This makes drawing easier later
    // since quads need to be given clockwise
    const startPoint = [startX, startY];
    const endPoint = [endX, endY];
    const minPoint = startX < endX ? startPoint : endPoint;
    const maxPoint = minPoint === startPoint ? endPoint : startPoint;
    this.points = [...minPoint, ...maxPoint];
    this.noiseGen = noiseGen;
  }

  startX() { return this.points[0]; }
  startY() { return this.points[1] + this.noiseGen.noise(); }
  endX() { return this.points[2]; }
  endY() { return this.points[3] + this.noiseGen.noise(); }

  draw() {
    const startX = this.startX(),
          startY = this.startY(),
          endX = this.endX(),
          endY = this.endY();
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

class SegmentsStore {
  constructor() {
    this.segments = [];
  }

  recordSegment(startX, startY, endX, endY, noiseGen) {
    const segment = new Segment(startX, startY, endX, endY, noiseGen);
    this.segments.push(segment);
    this.sort();

    return segment;
  }

  sort() {
    // Keep the segments sorted by y-position, so that we can treat taller rects
    // as being drawn further back in the z-position (painter's algorithm)
    this.segments.sort((a, b) => {
      const maxA = Math.max(a.startY(), a.endY());
      const maxB = Math.max(b.startY(), b.endY());
      return maxA - maxB;
    });
  }

  draw() {
    this.segments.forEach(segment => segment.draw());
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
      const startX = segment.startX(),
            startY = segment.startY(),
            endX = segment.endX(),
            endY = segment.endY();
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