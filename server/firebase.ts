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
