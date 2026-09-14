import { api } from './api';

const PREFIX = '/activities';

async function get(path = '', params) {
  const res = await api.get(`${PREFIX}${path}`, { params });
  return res.data?.data;
}

export const activityService = {
  getActivities: (params) => get('', params),
};

export default activityService;
