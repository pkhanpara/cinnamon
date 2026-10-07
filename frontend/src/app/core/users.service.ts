import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from './models';

export interface UserPatch {
  is_active?: boolean;
  is_admin?: boolean;
  password?: string;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);

  list(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }
  create(username: string, password: string, is_admin: boolean): Observable<User> {
    return this.http.post<User>('/api/users', { username, password, is_admin });
  }
  update(id: number, patch: UserPatch): Observable<User> {
    return this.http.patch<User>(`/api/users/${id}`, patch);
  }
}
