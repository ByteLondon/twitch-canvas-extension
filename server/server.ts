import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as bodyParser from 'koa-bodyparser'
const app = new Koa()
const router = new Router()
import firebase from 'firebase'
import { config } from '../shared/firebase'
import { signIn } from '../shared/firebase'
import { localCache } from './channel-points/localCache'

const firebaseApp = firebase.initializeApp(config)

const getTimestamp = async (uid: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    // Update user's "last_write" with
    // new timestamp

    const ref = firebase.database().ref(`last_write/` + uid)
    ref
      .set(firebase.database.ServerValue.TIMESTAMP)
      .then(() => {
        // Timestamp is saved, but because
        // the database generates this we
        // don't know what it is, so we have
        // to ask for it.

        ref
          .once('value')
          .then((timestamp) => {
            // We have the new timestamp.
            resolve(timestamp.val())
          })
          .catch(reject)
      })
      .catch(reject)
  })
}

app.use(bodyParser())

router.post('/api/setpixel', async (ctx: Koa.Context) => {
  const { body } = ctx.request
  if (!(await signIn(firebaseApp))) {
    ctx.status = 500
    return
  }

  //Check if the user has redeemed the channel points
  const originalUID = body?.data?.uid

  try {
    const ref = await firebaseApp
      .database()
      .ref(`redemptions/` + originalUID)
      .once('value')
    localCache[originalUID] = ref.val()

    if (localCache[originalUID] <= 0) {
      ctx.status = 403
      return
    }
  } catch (e) {
    await firebaseApp
      .database()
      .ref(`redemptions/` + originalUID)
      .set(0)
    ctx.status = 403
    return
  }

  body.data.uid = firebaseApp.auth().currentUser.uid

  body.data.timestamp = await getTimestamp(body.data.uid)

  //If so,
  await firebaseApp
    .database()
    .ref(`pixel/${body.currentPlace}-` + body.currentlyWriting)
    .set(body.data)
    .catch((error) => {
      console.error(error)
      ctx.status = 500
    })
  localCache[originalUID]--
  await firebaseApp
    .database()
    .ref(`redemptions/` + originalUID)
    .set(localCache[originalUID])
    .catch((error) => {
      console.error(error)
    })
  ctx.status = 200
})

app.use(router.routes())

const PORT = process.env.PORT || 3000

app.listen(PORT)

console.log(`Server listening on post ${PORT}`)
