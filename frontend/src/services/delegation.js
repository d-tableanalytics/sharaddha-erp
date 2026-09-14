/**
 * Delegation API service.
 *
 * Communicates with `/api/v1/delegation` to manage tasks delegated by the active user.
 * Follows the portal pattern using the shared axios instance with token refresh.
 */

import { api } from './api';

const PREFIX = '/delegation';

async function get(path = '', params) {
  const res = await api.get(`${PREFIX}${path}`, { params });
  return res.data?.data;
}

async function post(path = '', data) {
  const res = await api.post(`${PREFIX}${path}`, data);
  return res.data?.data;
}

async function put(path = '', data) {
  const res = await api.put(`${PREFIX}${path}`, data);
  return res.data?.data;
}

async function patch(path = '', data) {
  const res = await api.patch(`${PREFIX}${path}`, data);
  return res.data?.data;
}

async function del(path = '', params) {
  const res = await api.delete(`${PREFIX}${path}`, { params });
  return res.data?.data;
}

export const delegationService = {
  // Read
  getDelegations:        (params) => get('', params),
  getDeletedDelegations: (params) => get('/deleted', params),
  getDelegationById:     (id)     => get(`/${id}`),
  getCategories:         ()       => get('/meta/categories'),
  getUsers:              ()       => get('/meta/users'),

  // Task CRUD
  createDelegation:      (data)     => post('', data),
  updateDelegation:      (id, data) => put(`/${id}`, data),
  deleteDelegation:      (id)       => del(`/${id}`),
  restoreDelegation:     (id)       => patch(`/${id}/restore`),

  // Bulk Operations
  bulkUpdateStatus:      (ids, status) => post('/bulk-status', { ids, status }),
  bulkDelete:            (ids)         => post('/bulk-delete', { ids }),

  // Lifecycle actions
  verifyAndComplete: (id, data) => post(`/${id}/verify`, data),

  // Subtasks
  addSubtask:        (id, data) => post(`/${id}/subtasks`, data),
  toggleSubtask:     (id, subtaskId, completed) =>
    patch(`/${id}/subtasks/${subtaskId}/toggle`, { completed }),

  // Remarks / Audit trail
  addRemark:         (id, data) => post(`/${id}/remarks`, data),

  // Modals & Schedule
  reviseDueDate:     (id, data) => post(`/${id}/revise-date`, data),
  addReminder:       (id, data) => post(`/${id}/reminders`, data),
  addFollowUp:       (id, data) => post(`/${id}/follow-ups`, data),
};

export default delegationService;
