import Plugin from './Plugin'
import getSaga from './getSaga'
import getReducer from './getReducer'
import createStore from './createStore'
import createRender from './createRender'
import createModel from './createModel'
import registerModel from './registerModel'
import internalModel from './internalModel'
import createReducer from './createReducer'
import createHistory from './createHistory'
import { removeActions } from './actions'
import { CANCEL_EFFECTS } from './constants'
import { prefixType, fixNamespace } from './utils'
import steupHistoryHooks from './steupHistoryHooks'
import createErrorHandler from './createErrorHandler'

import { run as runSubscription, unlisten as unlistenSubscription } from './subscription'


export default function createApp(options = {}) {
  const {
    hooks = {},
    historyMode,
    initialState = {},
    initialReducer = {},
    extensions = {},
  } = options

  // supportted extensions
  const { createReducer: reducerCreator, combineReducers } = extensions

  // history and hooks
  const history = createHistory(historyMode)
  steupHistoryHooks(history, hooks)

  const app = {}
  const plugin = (new Plugin()).use(hooks)
  const regModel = m => (registerModel(app, m))

  return Object.assign(app, {
    plugin,
    history,
    actions: {},
    models: [createModel({ ...internalModel })],

    // check the namespace available or not
    has(namespace) {
      namespace = fixNamespace(namespace) // eslint-disable-line
      return app.models.some(m => m.namespace === namespace)
    },

    // register model before app is started
    model(raw) {
      regModel(raw)
      return app
    },

    eject(namespace) {
      namespace = fixNamespace(namespace) // eslint-disable-line
      app.models = app.models.filter(m => m.namespace !== namespace)
      removeActions(app, namespace)

      return app
    },

    load() {
      throw new Error('The method `load(pattern)` is unavailable. This method depend on `babel-plugin-mickey-model-loader`. For more information, see: https://github.com/mickeyjsx/babel-plugin-mickey-model-loader')
    },

    // create store, steup reducer, start the app
    render(component, container, callback) {
      const onError = createErrorHandler(app)
      const onEffect = plugin.get('onEffect')
      const extraReducers = plugin.get('extraReducers')
      const reducerEnhancer = plugin.get('onReducer')

      const sagas = []
      const reducers = { ...initialReducer }

      const innerGetSaga = m => getSaga(onError, onEffect, app, m)
      const innerGetReducer = m => getReducer(reducerCreator, m)
      const innerCreateReducer = asyncReducers => createReducer({
        reducers,
        asyncReducers,
        extraReducers,
        reducerEnhancer,
        combineReducers,
      })

      // handle reducers and sagas in model
      app.models.forEach((model) => {
        reducers[model.namespace] = innerGetReducer(model)
        sagas.push(innerGetSaga(model))
      })

      // create store
      const store = app.store = createStore({ // eslint-disable-line
        initialState,
        reducers: innerCreateReducer(),
        plugin,
        extraMiddlewares: plugin.get('onAction'),
        onStateChange: plugin.get('onStateChange'),
        extraEnhancers: plugin.get('extraEnhancers'),
        options,
      })

      // run sagas
      sagas.forEach(store.runSaga)

      const render = createRender(app, component, container, callback)
      render(component, container, callback)

      // run subscriptions after render
      const unlisteners = {}
      app.models.forEach((model) => {
        if (model.subscriptions) {
          unlisteners[model.namespace] = runSubscription(model.subscriptions, model, app, onError)
        }
      })

      // replace and inject some methods after the app started
      return Object.assign(app, {
        // after the first call fo render, the render function
        // should only do pure-render with any other actions
        render,
        onError,

        // inject model after app is started
        model(raw) {
          const { namespace, subscriptions } = raw
          const model = regModel(raw)

          store.asyncReducers[namespace] = innerGetReducer(model)
          store.replaceReducer(innerCreateReducer(store.asyncReducers))
          store.runSaga(innerGetSaga(model))

          if (model.subscriptions) {
            unlisteners[namespace] = runSubscription(subscriptions, model, app, onError)
          }

          return app
        },

        // remove model
        eject(namespace) {
          namespace = fixNamespace(namespace) // eslint-disable-line
          delete store.asyncReducers[namespace]
          delete reducers[namespace]

          // The pattern we recommend is to keep the old reducers around, so there's a warning
          // ref: https://stackoverflow.com/questions/34095804/replacereducer-causing-unexpected-key-error
          store.replaceReducer(innerCreateReducer(store.asyncReducers))
          store.dispatch({ type: '@@MICKEY/UPDATE' })
          store.dispatch({ type: prefixType(namespace, CANCEL_EFFECTS) })

          unlistenSubscription(unlisteners, namespace)

          app.models = app.models.filter(m => m.namespace !== namespace)
          removeActions(app, namespace)

          return app
        },
      })
    },
  })
}
