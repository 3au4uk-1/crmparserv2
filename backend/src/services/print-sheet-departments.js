import { config } from '../config.js';

export function resolvePrintSheetDepartment(companyId, map = config.printSheetDepartmentMap) {
  if (!companyId) return '';
  return map[companyId] ?? '';
}
