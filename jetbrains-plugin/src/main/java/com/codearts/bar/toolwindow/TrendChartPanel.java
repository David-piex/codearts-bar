package com.codearts.bar.toolwindow;

import com.codearts.bar.model.UsageSnapshot;
import com.intellij.ui.JBColor;
import com.intellij.util.ui.JBUI;

import javax.swing.*;
import java.awt.*;
import java.awt.geom.Path2D;
import java.text.DecimalFormat;
import java.util.List;

final class TrendChartPanel extends JPanel {
    private List<UsageSnapshot.TrendPoint> points = List.of();
    private boolean hourly = true;
    TrendChartPanel() { setPreferredSize(new Dimension(500, 260)); setBorder(JBUI.Borders.empty(12)); setOpaque(false); }
    void setData(List<UsageSnapshot.TrendPoint> points, boolean hourly) { this.points = points == null ? List.of() : points; this.hourly = hourly; repaint(); }
    @Override protected void paintComponent(Graphics graphics) {
        super.paintComponent(graphics);
        Graphics2D g=(Graphics2D)graphics.create();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            int left=54,right=18,top=20,bottom=38,w=getWidth()-left-right,h=getHeight()-top-bottom;
            g.setColor(JBColor.border());
            for(int i=0;i<=4;i++){int y=top+h*i/4;g.drawLine(left,y,left+w,y);}
            if(points.isEmpty()){g.setColor(JBColor.GRAY);g.drawString("No trend data for this range",left+12,top+h/2);return;}
            long max=points.stream().mapToLong(UsageSnapshot.TrendPoint::total).max().orElse(1); if(max<=0)max=1;
            g.setFont(getFont().deriveFont(11f)); g.setColor(JBColor.GRAY);
            for(int i=0;i<=4;i++){long value=Math.round(max*(4-i)/4d);g.drawString(compact(value),4,top+h*i/4+4);}
            Path2D line=new Path2D.Double(),fill=new Path2D.Double();
            for(int i=0;i<points.size();i++){double x=left+(points.size()==1?w/2d:w*i/(double)(points.size()-1));double y=top+h-(points.get(i).total()*h/(double)max);if(i==0){line.moveTo(x,y);fill.moveTo(x,top+h);fill.lineTo(x,y);}else{line.lineTo(x,y);fill.lineTo(x,y);}}
            double lastX=left+(points.size()==1?w/2d:w);fill.lineTo(lastX,top+h);fill.closePath();
            Color accent=new JBColor(new Color(58,122,254),new Color(94,154,255));
            g.setColor(new Color(accent.getRed(),accent.getGreen(),accent.getBlue(),45));g.fill(fill);
            g.setColor(accent);g.setStroke(new BasicStroke(2.2f));g.draw(line);
            int step=Math.max(1,points.size()/6);g.setColor(JBColor.GRAY);
            for(int i=0;i<points.size();i+=step){String label=label(points.get(i));int x=left+(points.size()==1?w/2:w*i/(points.size()-1));g.drawString(label,Math.max(left,x-22),top+h+22);}
        } finally { g.dispose(); }
    }
    private String label(UsageSnapshot.TrendPoint p){if(p.start()<=0)return p.label();var instant=java.time.Instant.ofEpochMilli(p.start()).atZone(java.time.ZoneId.systemDefault());return hourly?String.format("%02d:%02d",instant.getHour(),instant.getMinute()):String.format("%d/%d",instant.getMonthValue(),instant.getDayOfMonth());}
    private static String compact(long n){if(n>=1_000_000)return new DecimalFormat("0.0M").format(n/1_000_000d);if(n>=1_000)return new DecimalFormat("0.0K").format(n/1_000d);return Long.toString(n);}
}
