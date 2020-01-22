$(function(){
    $("nav ul li a").off('click').on('click', function(e){
       // e.preventDefault();
        $("nav ul li a").removeClass('active');
        $(this).addClass('active');
        $('#check').prop('checked',false);
    });
});