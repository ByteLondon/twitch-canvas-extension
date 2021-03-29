import firebase from 'firebase'
import * as PIXI from 'pixi.js'
import { Power3, TweenMax } from 'gsap'
import {
  clearColorSelectionOnCoolDown,
  colors,
  coolDownTime,
  gridSize,
  squareSize,
  zoomLevel,
} from '../../shared/config'
import ky from 'ky'
import { config, signIn } from '../../shared/firebase'
import { Pixel, Position } from './types'

const twitch = window.Twitch.ext

let body: HTMLElement = document.body
let canvasContainer: HTMLElement = document.getElementById('canvas')
let coolDownText: HTMLElement = document.getElementById('cooldown-text')
let zoomInButton: HTMLElement = document.getElementById('zoom-in')
let zoomOutButton: HTMLElement = document.getElementById('zoom-out')
let hideButton: HTMLElement = document.getElementById('hide')
let colorsBlock: HTMLElement = document.getElementById('colors')
let redemptionsBlock: HTMLElement = document.getElementById('redemptions-count')
let controlPanel: HTMLElement = document.getElementById('control-panel')
let colorOptions: HTMLElement[] = []

let uid: string = 'abc123'
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
let pixelLocation: string
let ready: boolean = false

let currentPlace = ''

let redemptionsCount = 0

const requests = {
  set: createRequest('POST', 'cycle'),
  get: createRequest('GET', 'query'),
}

function createRequest(type, method) {
  return {
    type: type,
    url: location.protocol + '//localhost:8081/color/' + method,
    success: updateBlock,
    error: logError,
  }
}

function logError(_, error, status) {
  twitch.rig.log('EBS request returned ' + status + ' (' + error + ')')
}

function updateBlock() {
  twitch.rig.log('Updating block color')
}

function setAuth(token) {
  Object.keys(requests).forEach((req) => {
    twitch.rig.log('Setting auth headers')
    requests[req].headers = { Authorization: 'Bearer ' + token }
  })
}

twitch.onAuthorized(function (auth) {
  currentPlace = auth.channelId
  uid = auth.userId
  setAuth(auth.token)
  body.classList.add('logged-in')
  getRedemptions()
})


body.classList.add('loading')

const firebaseApp = firebase.initializeApp(config)


setupStage()
setupColorOptions()

startListeners()


function writePixel(x: number, y: number, color: string) {
  twitch.rig.log(`writing ${color} pixel...`)

  const data: Pixel = {
    uid: uid,
    color: color,
  }

  pixelLocation = x + 'x' + y

  ky.post('/api/setpixel', {
    json: {
      data,
      currentlyWriting: pixelLocation,
      currentPlace,
    },
  })
    .then(() => {
      pixelLocation = null
      startCoolDown()

      twitch.rig.log('success!')
    })
    .catch(() => {
      twitch.rig.log('could not write pixel')
    })
}

function startCoolDown() {
  if (clearColorSelectionOnCoolDown) selectColor(null)

  body.classList.add('cooling')

  setTimeout(() => endCoolDown(), coolDownTime)

  coolCount = coolDownTime

  updateCoolCounter()

  clearInterval(coolInterval)
  coolInterval = setInterval(updateCoolCounter, 1000)
}

function updateCoolCounter() {
  let mins = String(Math.floor((coolCount / (1000 * 60)) % 60))
  let secs = String((coolCount / 1000) % 60)

  coolDownText.innerHTML = mins + ':' + (secs.length < 2 ? '0' : '') + secs

  coolCount -= 1000
}

function endCoolDown() {
  coolCount = 0

  clearInterval(coolInterval)

  body.classList.remove('cooling')
}

async function getRedemptions() {
  await signIn(firebaseApp)
  twitch.rig.log(`Getting redemptions for ${uid}`)
  firebase
    .database()
    .ref(`redemptions/${uid}`)
    .get()
    .then((e) => {
      redemptionsCount = e.val() || 0
      twitch.rig.log(`${e.val()} redemptions for ${uid}`)
      redemptionsBlock.innerText = `${redemptionsCount} Pixels`
      return e
    })
    .catch((e) => {
      twitch.rig.log(`Error getting redemptions ${e.message}`)
    })

  firebase
    .database()
    .ref(`redemptions/${uid}`)
    .on('child_changed', (change) => {
      twitch.rig.log(`Update on redemptions: ${change.key} - ${change.val()}`)
      if (change.key !== uid) return
      redemptionsCount = change.val() || 0
      redemptionsBlock.innerText = `${redemptionsCount} Pixels`
    })
}


function startListeners() {
  console.log('Starting Firebase listeners')

  let placeRef = firebase.database().ref(`pixel`)

  placeRef.on('child_changed', onChange)

  placeRef.on('child_added', onChange)

  ready = true
}

function onChange(change) {
  body.classList.remove('loading')
  const [location, key] = change.key.split('-')
  if (currentPlace !== location) return
  renderPixel(key, change.val())
}

function setupStage() {
  app = new PIXI.Application({
    width: 300,
    height: 300,
    antialias: false,
    transparent: true,
  })
  canvasContainer.appendChild(app.view)

  container = new PIXI.Container()

  app.stage.addChild(container)

  graphics = new PIXI.Graphics()
  graphics.beginFill(0xfefefe, 1)
  graphics.drawRect(0, 0, gridSize[0] * squareSize[0], gridSize[1] * squareSize[1])
  graphics.interactive = true

  graphics.on('pointerdown', onDown)
  graphics.on('pointermove', onMove)
  graphics.on('pointerup', onUp)
  graphics.on('pointerupoutside', onUp)

  graphics.position.x = 0
  graphics.position.y = 0

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

  window.onresize = onResize

  onResize()

  zoomInButton.addEventListener('click', () => {
    toggleZoom({ x: graphics.width / 2, y: graphics.height / 2 }, true)
  })
  zoomOutButton.addEventListener('click', () => {
    toggleZoom({ x: graphics.width / 2, y: graphics.height / 2 }, false)
  })
  hideButton.addEventListener('click', () => {
    const setTo = canvasContainer.style.display === 'none' ? 'block' : 'none'
    canvasContainer.style.display = setTo
    controlPanel.style.display = setTo
    hideButton.innerText = setTo === 'block' ? 'x' : '🖌'
  })
}

function drawLine(x, y, x2, y2) {
  gridLines.moveTo(x, y)
  gridLines.lineTo(x2, y2)
}

function setupColorOptions() {
  for (let i in colors) {
    let element = document.getElementById('c-' + colors[i])

    element.addEventListener('click', () => {
      selectColor(colors[i])
    })

    colorOptions.push(element)
  }
}

function selectColor(color: string) {
  if (selectedColor !== color) {
    selectedColor = color

    body.classList.add('selectedColor')
  } else {
    selectedColor = null

    body.classList.remove('selectedColor')
  }

  for (let i in colors) {
    if (colors[i] == selectedColor) colorOptions[i].classList.add('active')
    else colorOptions[i].classList.remove('active')
  }
}

function onResize() {
  app.renderer.resize(300, 300)

  container.position.x = 0
  container.position.y = 0
}

function onDown(e) {
  if (e.data.global.y < window.innerHeight - 60 && ready) {
    start = { x: e.data.global.x, y: e.data.global.y }

    mouseDown = true
  }
}

function onMove(e) {
  if (mouseDown) {
    if (!dragging && zoomed) {
      let pos = e.data.global

      if (Math.abs(start.x - pos.x) > 5 || Math.abs(start.y - pos.y) > 5) {
        graphicsStart = { x: graphics.position.x, y: graphics.position.y }

        dragging = true

        body.classList.add('dragging')
      }
    }

    if (dragging) {
      graphics.position.x = (e.data.global.x - start.x) / scale + graphicsStart.x
      graphics.position.y = (e.data.global.y - start.y) / scale + graphicsStart.y

      gridLines.position.x = (e.data.global.x - start.x) / scale + graphicsStart.x
      gridLines.position.y = (e.data.global.y - start.y) / scale + graphicsStart.y
    }
  }
}

function onUp(e) {
  body.classList.remove('dragging')

  if (mouseDown && ready) {
    mouseDown = false

    if (!dragging) {
      if (selectedColor && zoomed) {
        let position = e.data.getLocalPosition(graphics)

        let x = Math.floor(position.x / squareSize[0])
        let y = Math.floor(position.y / squareSize[1])

        writePixel(x, y, selectedColor)
      } else {
        toggleZoom(e.data.global)
      }
    }
    dragging = false
  }
}

function renderPixel(pos: string, pixel: Pixel) {
  let split = pos.split('x')

  let x = +split[0]
  let y = +split[1]

  let color = pixel.color

  graphics.beginFill(parseInt('0x' + color), 1)
  graphics.drawRect(x * squareSize[0], y * squareSize[1], squareSize[0], squareSize[1])
}

function toggleZoom(offset: Position, forceZoom?: boolean) {
  zoomed = forceZoom !== undefined ? forceZoom : !zoomed

  if (zoomed && redemptionsCount > 0) {
    colorsBlock.style.display = 'block'
    redemptionsBlock.style.display = 'none'
  } else {
    redemptionsBlock.style.display = 'block'
    colorsBlock.style.display = 'none'
  }

  scale = zoomed ? zoomLevel : 1

  if (zoomed) body.classList.add('zoomed')
  else body.classList.remove('zoomed')

  let opacity = zoomed ? 1 : 0

  TweenMax.to(container.scale, 0.5, { x: scale, y: scale, ease: Power3.easeInOut })
  let x = offset.x
  let y = offset.y
  let newX = zoomed ? -x + graphics.width / (2 * zoomLevel) : 0
  let newY = zoomed ? -y + graphics.height / (2 * zoomLevel) : 0
  TweenMax.to(graphics.position, 0.5, { x: newX, y: newY, ease: Power3.easeInOut })
  TweenMax.to(gridLines.position, 0.5, { x: newX, y: newY, ease: Power3.easeInOut })
  TweenMax.to(gridLines, 0.5, { alpha: opacity, ease: Power3.easeInOut })
}
