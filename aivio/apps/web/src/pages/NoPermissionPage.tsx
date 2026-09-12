import Card from "../components/Card";
import PageLayout from "../components/PageLayout";

export default function NoPermissionPage() {
  return (
    <PageLayout>
      <section className="permission-page">
        <Card className="permission-card">
          <div className="permission-visual" />
          <h1>无权限访问</h1>
          <p>当前账号没有管理后台权限，请联系管理员。</p>
        </Card>
      </section>
    </PageLayout>
  );
}
