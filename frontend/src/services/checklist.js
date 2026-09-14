/**
 * Checklist API service.
 *
 * Follows the same pattern as `services/o2d/client.js` — uses the shared
 * axios instance so the Bearer header, refresh cookie and single-flight
 * 401 refresh all still apply. Unwraps the `{ success, data }` envelope.
 */

import { api } from './api';

const PREFIX = '/checklist';

async function get(path, params) {
  const res = await api.get(`${PREFIX}${path}`, { params });
  return res.data?.data;
}

async function post(path, data) {
  const res = await api.post(`${PREFIX}${path}`, data);
  return res.data?.data;
}

async function put(path, data) {
  const res = await api.put(`${PREFIX}${path}`, data);
  return res.data?.data;
}

async function patch(path, data) {
  const res = await api.patch(`${PREFIX}${path}`, data);
  return res.data?.data;
}

// ── Public API ───────────────────────────────────────────────────────────────

export const checklistApi = {
  // Read
  getTasks:         (params) => get('/tasks', params),
  getSummary:       (params) => get('/summary', params),
  getRoutines:      (params) => get('/routines', params),
  getDepartments:   (params) => get('/departments', params),
  getDrilldown:     (params) => get('/tasks/drilldown', params),
  getUsers:         ()       => get('/users'),
  getLocations:     ()       => get('/locations'),
  getDepartmentsList: ()     => get('/departments-list'),

  // Write
  createRoutine:    (data)     => post('/routines', data),
  updateRoutine:    (id, data) => put(`/routines/${id}`, data),
  stopRoutine:      (id)       => patch(`/routines/${id}/stop`),
  completeTask:     (id, data) => patch(`/tasks/${id}/complete`, data),
  markNonFunctional:(id, data) => patch(`/tasks/${id}/non-functional`, data),
  reassignTask:     (id, data) => patch(`/tasks/${id}/reassign`, data),
  addRemark:        (data)     => post('/tasks/remark', data),
};

export default checklistApi;
