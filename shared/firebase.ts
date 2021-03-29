export const config = {
  apiKey: process.env.API_KEY,
  authDomain: 'place-extension.firebaseapp.com',
  databaseURL: process.env.DATABASE_URL,
  projectId: 'place-extension',
  storageBucket: 'place-extension.appspot.com',
  messagingSenderId: process.env.MESSAGING_SENDER_ID,
  appId: process.env.APP_ID,
}

import firebase from 'firebase'
import App = firebase.app.App

let authenticated = false

export const signIn = async (firebaseApp: App) => {
  if (authenticated) {
    return true
  }
  try {
    await firebaseApp
      .auth()
      .signInAnonymously()
      .catch((error) => console.log('error logging in', error))
    authenticated = true
    return true
  } catch (error) {
    console.log('error logging in', error)
    return false
  }
}
