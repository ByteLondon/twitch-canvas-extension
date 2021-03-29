import firebase from 'firebase'
import * as PIXI from 'pixi.js'
import { TweenMax, Power3 } from 'gsap'
import {
  clearColorSelectionOnCoolDown,
  colors,
  coolDownTime,
  currentPlace,
  gridSize,
  squareSize,
  zoomLevel,
} from '../../shared/config'
import ky from 'ky'
import { config } from '../../shared/firebase'

const twitch = window.Twitch.ext;

twitch.rig.log('Hello World')

const requests = {
  set: createRequest('POST', 'cycle'),
  get: createRequest('GET', 'query')
};

function createRequest(type, method) {
  return {
    type: type,
    url: location.protocol + '//localhost:8081/color/' + method,
    success: updateBlock,
    error: logError
  }
}

function logError(_, error, status) {
  twitch.rig.log('EBS request returned '+status+' ('+error+')');
}

function updateBlock() {
  twitch.rig.log('Updating block color');
}

function setAuth(token) {
  Object.keys(requests).forEach((req) => {
    twitch.rig.log('Setting auth headers');
    requests[req].headers = { 'Authorization': 'Bearer ' + token }
  });
}

twitch.onAuthorized(function(auth) {
  // save our credentials
  uid = auth.userId;
  setAuth(auth.token);
});

// First off, lets clear that blasted console
console.clear()

// TypeScript interfaces

interface Pixel {
  uid: string
  color: string
}

interface Position {
  x: number
  y: number
}

// Get DOM elements

let body: HTMLElement = document.body
let canvasContainer: HTMLElement = document.getElementById('canvas')
let coolDownText: HTMLElement = document.getElementById('cooldown-text')
let zoomInButton: HTMLElement = document.getElementById('zoom-in')
let zoomOutButton: HTMLElement = document.getElementById('zoom-out')
let hideButton: HTMLElement = document.getElementById('hide')
let colorOptions: HTMLElement[] = []

// set loading state

body.classList.add('loading')
body.classList.add('logged-in')

// Define variables

let uid: string
let app: any
let graphics: any
let gridLines: any
let container: any
let dragging: boolean = false
let mouseDown: boolean = false
let start: Position
let graphicsStart: Position
let selectedColor: string
let zoomed: boolean = false
let coolCount: number = 0
let coolInterval: any
let scale: number = 1
let currentlyWriting: string
let ready: boolean = false

// Setup Firebase
firebase.initializeApp(config)

// Check if user is logged in

// run stage setup
setupStage()
setupColorOptions()

// start listening for new pixels
startListeners()

// Write pixel to database functions

function writePixel(x: number, y: number, color: string) {
  console.log(`writing ${color} pixel...`)

  // First we need to get a valid timestamp.
  // To stop spamming the rules on the database
  // prevent creating a new timestamp within a
  // set period.

  // we've successfully set a new timestamp.
  // This means the cooldown period is
  // over and the user is free to save
  // their new pixel to the database
  //TODO: Get UID from Twitch
  const data: Pixel = {
    uid: 'abc123',
    color: color,
  }

  currentlyWriting = x + 'x' + y

  // We set the new pixel data with the key 'XxY'
  // for example "56x93"
  ky.post('/api/setpixel', {
    json: {
      data,
      currentlyWriting,
      currentPlace,
    },
  })
    .then(() => {
      // Pixel successfully saved, we'll wait for
      // the pixel listeners to pick up the new
      // pixel before drawing it on the canvas.
      currentlyWriting = null
      startCoolDown()

      console.log('success!')
    })
    .catch(() => {
      // Error here is probably due to the internet
      // connection going down between generating
      // the timestamp and saving the pixel.
      // The database has a rule set to check the
      // timestamp generated and the timestamp
      // sent with the pixel.

      // It could also be due to usage limits on
      // the free tier of Firebase.

      console.error('could not write pixel')
    })
}

function startCoolDown() {
  // deselect the color
  if (clearColorSelectionOnCoolDown) selectColor(null)

  // add the .cooling class to the body
  // So the countdown clock appears
  body.classList.add('cooling')

  // start a timeout for the cooldown time
  // in milliseconds, the milliseconds are
  // also set in the database rules so removing
  // this code doesn't allow the user to skip
  // cooldown
  setTimeout(() => endCoolDown(), coolDownTime)

  // coolCount (😎) is used to write the countdown
  // clock.
  coolCount = coolDownTime

  // update countdown clock first
  updateCoolCounter()

  // start an interval to update the countdown
  // clock every second
  clearInterval(coolInterval)
  coolInterval = setInterval(updateCoolCounter, 1000)
}

function updateCoolCounter() {
  // Work out minutes and seconds left from
  // the remaining milliseconds in coolCount
  let mins = String(Math.floor((coolCount / (1000 * 60)) % 60))
  let secs = String((coolCount / 1000) % 60)

  // update the cooldown counter in the DOM
  coolDownText.innerHTML = mins + ':' + (secs.length < 2 ? '0' : '') + secs

  // remove 1 secound (1000 milliseconds)
  // ready for the next update.
  coolCount -= 1000
}

function endCoolDown() {
  // set coolCount to 0, just in case it went
  // over, intervals aren't perfect.
  coolCount = 0

  // stop the update interval
  clearInterval(coolInterval)

  // remove the .cooling class from the body
  // so that the countdown clock is hidden.
  body.classList.remove('cooling')
}

// Draw pixel functions

function startListeners() {
  console.log('Starting Firebase listeners')

  // get a reference to the pixel table
  // in the database
  let placeRef = firebase.database().ref(`pixel`)

  // get once update on all the values
  // in the grid so we can draw everything
  // on first load.
  // placeRef.once('value')
  // 	.then(snapshot =>
  // 	{
  // 		// draw all the pixels in the grid
  // 		var grid = snapshot.val();
  // 		for(let i in grid)
  // 		{
  // 			renderPixel(i, grid[i]);
  // 		}

  // start listening for changes to pixels
  placeRef.on('child_changed', onChange)

  // also start listening for new pixels,
  // grid position that have never had a
  // pixel drawn on them are new.
  placeRef.on('child_added', onChange)
  // })
  // .catch(error => {
  // 	console.log(error);
  // })

  ready = true
}

function onChange(change) {
  body.classList.remove('loading')
  const [location, key] = change.key.split('-')
  if (currentPlace !== location) return
  // render the new pixel
  // key will be the grid position,
  // for example "34x764"
  // val will be a pixel object defined
  // by the Pixel interface at the top.
  renderPixel(key, change.val())
}

function setupStage() {
  // Setting up canvas with Pixi.js
  app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight - 60,
    antialias: false,
    transparent: true
  })
  canvasContainer.appendChild(app.view)

  // create a container for the grid
  // container will be used for zooming
  container = new PIXI.Container()

  // and container to the stage
  app.stage.addChild(container)

  // graphics is the cavas we draw the
  // pixels on, well also move this around
  // when the user drags around
  graphics = new PIXI.Graphics()
  graphics.beginFill(0xfefefe, 1)
  graphics.drawRect(0, 0, gridSize[0] * squareSize[0], gridSize[1] * squareSize[1])
  graphics.interactive = true

  // setup input listeners, we use
  // pointerdown, pointermove, etc
  // rather than mousedown, mousemove,
  // etc, because it triggers on both
  // mouse and touch
  graphics.on('pointerdown', onDown)
  graphics.on('pointermove', onMove)
  graphics.on('pointerup', onUp)
  graphics.on('pointerupoutside', onUp)

  // move graphics so that it's center
  // is at x0 y0
  graphics.position.x = -graphics.width / 2
  graphics.position.y = -graphics.height / 2

  // place graphics into the container
  container.addChild(graphics)

  gridLines = new PIXI.Graphics()
  gridLines.lineStyle(0.5, 0x888888, 1)
  gridLines.alpha = 0

  gridLines.position.x = graphics.position.x
  gridLines.position.y = graphics.position.y

  for (let i = 0; i <= gridSize[0]; i++) {
    drawLine(0, i * squareSize[0], gridSize[0] * squareSize[0], i * squareSize[0])
  }
  for (let j = 0; j <= gridSize[1]; j++) {
    drawLine(j * squareSize[1], 0, j * squareSize[1], gridSize[1] * squareSize[1])
  }

  container.addChild(gridLines)

  // start page resize listener, so
  // we can keep the canvas the correct
  // size
  window.onresize = onResize

  // make canvas fill the screen.
  onResize()

  // add zoom button controls
  zoomInButton.addEventListener('click', () => {
    toggleZoom({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, true)
  })
  zoomOutButton.addEventListener('click', () => {
    toggleZoom({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, false)
  })
  hideButton.addEventListener('click', () => {
    const setTo = canvasContainer.style.display === "none" ? "block" : "none"
    canvasContainer.style.display = setTo
  })
}

function drawLine(x, y, x2, y2) {
  gridLines.moveTo(x, y)
  gridLines.lineTo(x2, y2)
}

function setupColorOptions() {
  // link up the color options with
  // a click function.
  for (let i in colors) {
    // each color button has an id="c-" then
    // the color value, for example "c-ffffff"
    // is the white color buttton.
    let element = document.getElementById('c-' + colors[i])

    // on click send the color to the selectColor
    // function
    element.addEventListener('click', () => {
      selectColor(colors[i])
    })

    // add the DOM element to an array so
    // we can use it again later
    colorOptions.push(element)
  }
}

function selectColor(color: string) {
  if (selectedColor !== color) {
    // if the new color does not match
    // the current selected color then
    // change it the new one
    selectedColor = color

    // add the .selectedColor class to
    // the body tag. We use this to update
    // the info box instructions.
    body.classList.add('selectedColor')
  } else {
    // if the new color matches the
    // currently selected on the user
    // is toggling the color off.
    selectedColor = null

    // remove the .selectedColor class
    // from the body.
    body.classList.remove('selectedColor')
  }

  for (let i in colors) {
    // loop through all the colors in,
    // if the color equals the selected
    // color add the .active class to the
    // button element
    if (colors[i] == selectedColor) colorOptions[i].classList.add('active')
    // otherwise remove the .active class
    else colorOptions[i].classList.remove('active')
  }
}

function onResize() {
  // resize the canvas to fill the screen
  app.renderer.resize(window.innerWidth, window.innerHeight)

  // center the container to the new
  // window size.
  container.position.x = window.innerWidth / 2
  container.position.y = window.innerHeight / 2
}

function onDown(e) {
  // Pixi.js adds all its mouse listeners
  // to the window, regardless of which
  // element they are assigned to inside the
  // canvas. So to avoid zooming in when
  // selecting a color we first check if the
  // click is not withing the bottom 60px where
  // the color options are
  if (e.data.global.y < window.innerHeight - 60 && ready) {
    // We save the mouse down position
    start = { x: e.data.global.x, y: e.data.global.y }

    // And set a flag to say the mouse
    // is now down
    mouseDown = true
  }
}

function onMove(e) {
  // check if mouse is down (in other words
  // check if the user has clicked or touched
  // down and not yet lifted off)
  if (mouseDown) {
    // if not yet detected a drag then...
    if (!dragging) {
      // we get the mouses current position
      let pos = e.data.global

      // and check if that new position has
      // move more than 5 pixels in any direction
      // from the first mouse down position
      if (Math.abs(start.x - pos.x) > 5 || Math.abs(start.y - pos.y) > 5) {
        // if it has we can assume the user
        // is trying to draw the view around
        // and not clicking. We store the
        // graphics current position do we
        // can offset its postion with the
        // mouse position later.
        graphicsStart = { x: graphics.position.x, y: graphics.position.y }

        // set the dragging flag
        dragging = true

        // add the .dragging class to the
        // DOM so we can switch to the
        // move cursor
        body.classList.add('dragging')
      }
    }

    if (dragging) {
      // update the graphics position based
      // on the mouse position, offset with the
      // start and graphics orginal positions
      graphics.position.x = (e.data.global.x - start.x) / scale + graphicsStart.x
      graphics.position.y = (e.data.global.y - start.y) / scale + graphicsStart.y

      gridLines.position.x = (e.data.global.x - start.x) / scale + graphicsStart.x
      gridLines.position.y = (e.data.global.y - start.y) / scale + graphicsStart.y
    }
  }
}

function onUp(e) {
  // clear the .dragging class from DOM
  body.classList.remove('dragging')

  // ignore the mouse up if the mouse down
  // was out of bounds (e.g in the bottom
  // 60px)
  if (mouseDown && ready) {
    // clear mouseDown flag
    mouseDown = false

    // if the dragging flag was never set
    // during all the mouse moves then this
    // is a click
    if (!dragging) {
      // if a color has been selected and
      // the view is zoomed in then this
      // click is to draw a new pixel
      if (selectedColor && zoomed) {
        // get the latest mouse position
        let position = e.data.getLocalPosition(graphics)

        // round the x and y down
        let x = Math.floor(position.x / squareSize[0])
        let y = Math.floor(position.y / squareSize[1])

        writePixel(x, y, selectedColor)
      } else {
        // either a color has not been selected
        // or it has but the user is zoomed out,
        // either way this click is to toggle the
        // zoom level
        toggleZoom(e.data.global)
      }
    }
    dragging = false
  }
}

function renderPixel(pos: string, pixel: Pixel) {
  // split the pos string at the 'x'
  // so '100x200' would become an
  // array ['100', '200']
  let split = pos.split('x')

  // assign the values to x and y
  // vars using + to convert the
  // string to a number
  let x = +split[0]
  let y = +split[1]

  // grab the color from the pixel
  // object
  let color = pixel.color

  // draw the square on the graphics canvas
  graphics.beginFill(parseInt('0x' + color), 1)
  graphics.drawRect(x * squareSize[0], y * squareSize[1], squareSize[0], squareSize[1])
}

function toggleZoom(offset: Position, forceZoom?: boolean) {
  // toggle the zoomed varable
  zoomed = forceZoom !== undefined ? forceZoom : !zoomed

  // scale will equal 4 if zoomed (so 4x bigger),
  // other otherwise the scale will be 1
  scale = zoomed ? zoomLevel : 1

  // add or remove the .zoomed class to the
  // body tag. This is so we can change the
  // info box instructions
  if (zoomed) body.classList.add('zoomed')
  else body.classList.remove('zoomed')

  let opacity = zoomed ? 1 : 0

  // Use GSAP to animate between scales.
  // We are scaling the container and not
  // the graphics.
  TweenMax.to(container.scale, 0.5, { x: scale, y: scale, ease: Power3.easeInOut })
  let x = offset.x - window.innerWidth / 2
  let y = offset.y - window.innerHeight / 2
  let newX = zoomed ? graphics.position.x - x : graphics.position.x + x
  let newY = zoomed ? graphics.position.y - y : graphics.position.y + y
  TweenMax.to(graphics.position, 0.5, { x: newX, y: newY, ease: Power3.easeInOut })
  TweenMax.to(gridLines.position, 0.5, { x: newX, y: newY, ease: Power3.easeInOut })
  TweenMax.to(gridLines, 0.5, { alpha: opacity, ease: Power3.easeInOut })
}

/*

Firebase database rules are set to...

{
  "rules": {
    "last_write": {
      "$user": {
        ".read": "auth.uid === $user",
        ".write": "newData.exists() && auth.uid === $user",
        ".validate": "newData.isNumber() && newData.val() === now && (!data.exists() || newData.val() > data.val()+10000)"
      }
    },
    "pixel": {
      ".read": "true",
      "$square": {
        	".write": "auth !== null",
        	".validate": "newData.hasChildren(['uid', 'color', 'timestamp']) && $square.matches(/^([0-9]|[1-9][0-9]|[1-9][0-9][0-9])x([0-9]|[1-9][0-9]|[1-9][0-9][0-9])$/)",
      		"uid": {
            ".validate": "newData.val() === auth.uid"
          },
          "timestamp": {
            ".validate": "newData.val() >= now - 500 && newData.val() === data.parent().parent().parent().child('last_write/'+auth.uid).val()"
          },
          "color": {
            ".validate": "newData.isString() && newData.val().length === 6 && newData.val().matches(/^(ffffff|e4e4e4|888888|222222|ffa7d1|e50000|e59500|a06a42|e5d900|94e044|02be01|00d3dd|0083c7|0000ea|cf6ee4|820080)$/)"
          }
      }
    }
  }
}

*/

// the rules to prevent adding pixels during cooldown
// were written with help from http://stackoverflow.com/a/24841859
