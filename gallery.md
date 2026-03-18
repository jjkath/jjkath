---
layout: default
title: Gallery
permalink: /gallery/
---
<section class="section">
  <div class="container">
    <div class="section-head">
      <div>
        <p class="eyebrow">PORTFOLIO</p>
        <h1>Gallery</h1>
      </div>
    </div>
    <div class="gallery-grid">
      {% for post in site.posts %}
      <article class="card">
        <a class="card-image-wrap" href="{{ post.url | relative_url }}">
          <img class="card-image" src="{{ post.image | relative_url }}" alt="{{ post.title }}">
        </a>
        <div class="card-body">
          <div class="meta-row">
            <span class="pill">{{ post.object_type }}</span>
            <span class="muted">{{ post.capture_date }}</span>
          </div>
          <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
          <p>{{ post.location }} · {{ post.exposure }}</p>
        </div>
      </article>
      {% endfor %}
    </div>
  </div>
</section>
