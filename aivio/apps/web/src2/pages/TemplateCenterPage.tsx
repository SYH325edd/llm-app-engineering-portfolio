import { Search, Sparkles } from "lucide-react";
import Button from "../components/Button";
import Card from "../components/Card";
import PageLayout from "../components/PageLayout";
import { templateCategories, templates } from "../mock/templates";

export default function TemplateCenterPage() {
  return (
    <PageLayout>
      <section className="template-head">
        <div>
          <h1>模板中心</h1>
          <p>选择创意模板，快速开始视频创作。</p>
        </div>
        <Card className="template-tip">
          <Sparkles size={22} />
          <div>
            <strong>AIVio 模板中心</strong>
            <span>精选创意结构，帮助你更快完成视频生成。</span>
          </div>
        </Card>
      </section>

      <section className="template-toolbar">
        <div className="template-categories">
          {templateCategories.map((category, index) => (
            <button className={index === 0 ? "active" : ""} type="button" key={category}>
              {category}
            </button>
          ))}
        </div>
        <label className="search-box template-search">
          <Search size={18} />
          <input placeholder="搜索模板名称或用途" />
        </label>
      </section>

      <section className="template-grid">
        {templates.map((item) => (
          <Card className="template-card" key={item.title}>
            <div className={`template-cover template-${item.image}`} />
            <div className="template-body">
              <div className="card-title-row">
                <h3>{item.title}</h3>
                <span>{item.uses} 次使用</span>
              </div>
              <p>{item.desc}</p>
              <div className="template-tags">
                {item.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <Button>使用模板</Button>
            </div>
          </Card>
        ))}
      </section>
    </PageLayout>
  );
}
