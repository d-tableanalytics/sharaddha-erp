import { api } from './api';

const PREFIX = '/scoreboard';

async function get(path = '', params) {
  const res = await api.get(`${PREFIX}${path}`, { params });
  return res.data?.data;
}

async function post(path = '', data) {
  const res = await api.post(`${PREFIX}${path}`, data);
  return res.data?.data;
}

export const scoreboardApi = {
  getScoreboard: (params) => get('', params),
  updateGoal: (data) => post('/goals', data),
};

export default scoreboardApi;
