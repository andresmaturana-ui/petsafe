// Punto de entrada de los datos: usa Supabase si está configurado
// (src/config.js) y si no, el almacenamiento local del navegador.

import * as local from './data-local.js';
import * as remote from './data-remote.js';
import { CLOUD } from './config.js';

export { CLOUD };

const impl = CLOUD ? remote : local;
const call = (name) => (...args) => impl[name](...args);

export const currentUser = call('currentUser');
export const saveUser = call('saveUser');
export const switchUser = call('switchUser');
export const listUsers = call('listUsers');
export const registerPet = call('registerPet');
export const myPets = call('myPets');
export const getPet = call('getPet');
export const allPets = call('allPets');
export const savePet = call('savePet');
export const removeMyPet = call('removeMyPet');
export const reportLost = call('reportLost');
export const markRecovered = call('markRecovered');
export const reportFound = call('reportFound');
export const getFound = call('getFound');
export const allFound = call('allFound');
export const saveFound = call('saveFound');
export const deleteFound = call('deleteFound');
export const notify = call('notify');
export const notifyAll = call('notifyAll');
export const deliverPending = call('deliverPending');
export const myNotifications = call('myNotifications');
export const markRead = call('markRead');
export const latestSuccesses = call('latestSuccesses');
export const getSuccess = call('getSuccess');
export const deleteSuccess = call('deleteSuccess');
export const commentsFor = call('commentsFor');
export const addComment = call('addComment');
export const deleteComment = call('deleteComment');
export const countComments = call('countComments');
export const addSuccess = call('addSuccess');
export const isAdmin = call('isAdmin');
export const claimAdmin = call('claimAdmin');
export const contactAdmin = call('contactAdmin');
export const listContacts = call('listContacts');
export const markContactRead = call('markContactRead');
export const deleteContact = call('deleteContact');
