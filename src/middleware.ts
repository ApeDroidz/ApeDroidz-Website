import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  // 1. ВАЖНО: Не блокируем API и системные файлы, 
  // чтобы смарт-контракт мог читать метаданные, а сайт грузить картинки
  if (
    req.nextUrl.pathname.startsWith('/api') || 
    req.nextUrl.pathname.startsWith('/_next') || 
    req.nextUrl.pathname.includes('.') // пропускаем файлы с расширением (картинки, фавиконки)
  ) {
    return NextResponse.next()
  }

  // 2. Проверяем наличие авторизации
  const basicAuth = req.headers.get('authorization')

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1]
    // Декодируем base64
    const [user, pwd] = atob(authValue).split(':')

    // === ТВОИ ЛОГИН И ПАРОЛЬ ===
    // Поменяй их на свои!
    if (user === 'SPLITF0RM' && pwd === 'DroidFather33') {
      return NextResponse.next()
    }
  }

  // 3. Если пароля нет или он неверный — показываем окно входа
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  })
}