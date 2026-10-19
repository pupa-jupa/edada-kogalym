import { getChatGPTUser } from './chatgpt-auth';
import FoodApp from './food-app';
export const dynamic='force-dynamic';
export default async function Home(){
  const user=await getChatGPTUser();
  if(!user)return <main className="login-page"><div className="brand"><span className="brand-icon">е</span>еда<span>да</span><i>●</i></div><p className="eyebrow">КОГАЛЫМ · ЕДА СО СМЫСЛОМ</p><h1>Ваш рацион.<br/>Ваши правила.</h1><p>Подберём блюда под ваш бюджет и КБЖУ.<br/>Соберём продукты в магазинах вашего города.</p><a className="button primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">Войти через ChatGPT <span>↗</span></a><small>Личный кабинет. Цены и API-ключи доступны только вам.</small></main>;
  return <FoodApp displayName={user.fullName??'Мой профиль'}/>;
}
