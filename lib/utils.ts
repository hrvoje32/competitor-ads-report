export const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month: number, year: number) => `${months[month - 1] ?? month} ${year}`;
